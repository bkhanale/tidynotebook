/**
 * PostgreSQL implementation of the workspace storage ports.
 *
 * One call to `transact` opens one database transaction. It sets the actor
 * identity for that transaction only, then locks the workspace row. The lock
 * gives every write of one workspace a defined order, so the commit ordered
 * cursor cannot skip a transaction that commits late.
 *
 * `accept` performs the atomic write. It runs inside a savepoint, so an
 * expected domain failure such as a path conflict or a full workspace leaves
 * the open transaction usable and writes nothing. An infrastructure failure
 * throws `OperationalError` instead.
 */
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  OperationalError,
  fail,
  ok,
  type AcceptedChangeset,
  type Actor,
  type ChangesetInput,
  type Result,
  type RevisionInput,
  type Role,
  type WorkspaceStore,
  type WorkspaceTransaction,
} from '@notesapp/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {
  attachmentObjects,
  changesets,
  contents,
  files,
  livePaths,
  memberships,
  mutationReceipts,
  purgeMarkers,
  revisionParents,
  revisions,
  syncChanges,
  workspaceCursors,
  workspaceUsage,
} from './schema.ts';

/** Bytes charged for the metadata of one accepted revision. */
const revisionOverheadBytes = 512n;

/** Bytes charged for one retained mutation receipt. */
const receiptOverheadBytes = 512n;

/**
 * Quota headroom that only a control operation may use.
 *
 * A changeset that adds no new content is a control operation: a deletion, a
 * rename, or a restore of content that the workspace already holds. Such an
 * operation skips the quota check, so a full workspace stays manageable. A
 * changeset that adds content must fit below the quota minus this reserve, so
 * the headroom cannot be consumed by new content.
 */
const controlReserveBytes = 1n << 20n;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Options of one storage pool. */
export type WorkspaceStoreOptions = {
  /** Maximum pooled connections. A test uses one to reuse one connection. */
  readonly poolSize?: number;
  /** Statement timeout of every pooled connection, in milliseconds. */
  readonly statementTimeoutMs?: number;
};

/** A workspace store and the calls that a process needs to manage its pool. */
export type WorkspaceStoreHandle = WorkspaceStore & {
  /**
   * The identity setting of a pooled connection outside a transaction.
   *
   * The value must be `null`. The transaction identity is set with the local
   * flag of `set_config`, so it disappears at commit or rollback and cannot
   * reach the next user of the connection.
   */
  readConnectionIdentity(): Promise<string | null>;
  /** Closes every pooled connection. */
  close(): Promise<void>;
};

/** A PostgreSQL failure, as the driver reports it. */
type PostgresFailure = {
  readonly code: string;
  readonly constraint: string | null;
};

/** Reads the PostgreSQL failure out of a thrown value and its causes. */
function postgresFailure(value: unknown): PostgresFailure | null {
  let current: unknown = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    if ('code' in current && typeof current.code === 'string') {
      const constraint =
        'constraint' in current && typeof current.constraint === 'string'
          ? current.constraint
          : null;
      return { code: current.code, constraint };
    }
    if (!('cause' in current)) return null;
    current = current.cause;
  }
  return null;
}

/** Wraps an unexpected failure as an infrastructure failure. */
function operational(value: unknown): OperationalError {
  if (value instanceof OperationalError) return value;
  const failure = postgresFailure(value);
  const kind =
    failure === null
      ? 'unexpected'
      : failure.code === '40001' || failure.code === '40P01'
        ? 'serialization'
        : failure.code.startsWith('08')
          ? 'unavailable'
          : failure.code === '57014'
            ? 'timeout'
            : 'unexpected';
  return new OperationalError(kind, 'notesapp: the workspace store failed.', {
    cause: value,
  });
}

/**
 * Maps a SQL failure that is an expected domain outcome.
 *
 * Only the named constraints below are expected outcomes of a valid request.
 * Every other failure stays an infrastructure failure, so a defect cannot hide
 * behind a domain error code.
 */
function domainFailure(
  value: unknown,
  fileIds: readonly string[],
): Result<AcceptedChangeset> | null {
  const failure = postgresFailure(value);
  if (failure === null) return null;
  const constraint = failure.constraint ?? '';
  if (failure.code === '23505') {
    if (constraint === 'live_paths_path_key')
      return fail('path_conflict', fileIds);
    if (constraint === 'changesets_mutation_key') {
      return fail('mutation_reused', fileIds);
    }
    if (constraint.startsWith('mutation_receipts')) {
      return fail('mutation_reused', fileIds);
    }
    return null;
  }
  if (failure.code === '23503') {
    if (
      constraint === 'revision_parents_parent_fk' ||
      constraint === 'revision_parents_child_fk' ||
      constraint === 'revisions_restored_from_fk' ||
      constraint === 'revisions_content_fk' ||
      constraint === 'revisions_file_fk' ||
      constraint === 'files_head_revision_fk'
    ) {
      return fail('invalid_graph', fileIds);
    }
    return null;
  }
  if (failure.code === '23514' && constraint.startsWith('revision_parents')) {
    return fail('invalid_graph', fileIds);
  }
  return null;
}

/** Rejects an identifier that is not a UUID before it reaches SQL. */
function assertUuid(value: string, what: string): void {
  if (!uuidPattern.test(value)) {
    throw new OperationalError(
      'unexpected',
      `notesapp: ${what} is not a UUID; the transport must validate it.`,
    );
  }
}

/** Reads the stored outcome of a mutation receipt. */
function parseOutcome(value: unknown): AcceptedChangeset {
  if (
    typeof value === 'object' &&
    value !== null &&
    'mutationId' in value &&
    typeof value.mutationId === 'string' &&
    'cursor' in value &&
    typeof value.cursor === 'string' &&
    'revisionIds' in value &&
    Array.isArray(value.revisionIds) &&
    value.revisionIds.every((entry: unknown) => typeof entry === 'string')
  ) {
    return {
      mutationId: value.mutationId,
      cursor: value.cursor,
      revisionIds: [...value.revisionIds],
    };
  }
  throw new OperationalError(
    'unexpected',
    'notesapp: a stored mutation outcome has an unknown shape.',
  );
}

/** The last submitted revision of each file, which becomes its new head. */
function tips(input: ChangesetInput): ReadonlyMap<string, RevisionInput> {
  const result = new Map<string, RevisionInput>();
  for (const revision of input.revisions) result.set(revision.fileId, revision);
  return result;
}

/** Parses an informational client timestamp. */
function clientTime(revision: RevisionInput): Date {
  const parsed = new Date(revision.clientTime);
  if (Number.isNaN(parsed.getTime())) {
    throw new OperationalError(
      'unexpected',
      'notesapp: a client timestamp is not a valid instant.',
    );
  }
  return parsed;
}

/** Opens a workspace store over one PostgreSQL connection pool. */
export function openWorkspaceStore(
  databaseUrl: string,
  options: WorkspaceStoreOptions = {},
): WorkspaceStoreHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.poolSize ?? 10,
    ...(options.statementTimeoutMs === undefined
      ? {}
      : { statement_timeout: options.statementTimeoutMs }),
  });

  return {
    async transact<T>(
      actor: Actor,
      workspaceId: string,
      run: (tx: WorkspaceTransaction) => Promise<T>,
    ): Promise<T> {
      assertUuid(actor.accountId, 'the actor account');
      assertUuid(workspaceId, 'the workspace');
      const client = await pool.connect();
      try {
        const db = drizzle({ client });
        await client.query('begin');
        try {
          await client.query(
            "select set_config('notesapp.account_id', $1, true)",
            [actor.accountId],
          );
          await client.query(
            'select id from workspaces where id = $1 for update',
            [workspaceId],
          );
          const value = await run(
            createTransaction(client, db, actor, workspaceId),
          );
          await client.query('commit');
          return value;
        } catch (error) {
          try {
            await client.query('rollback');
          } catch {
            // The connection is already unusable; report the first failure.
          }
          throw operational(error);
        }
      } finally {
        client.release();
      }
    },

    async readConnectionIdentity(): Promise<string | null> {
      const client = await pool.connect();
      try {
        const result = await client.query<{ value: string | null }>(
          "select nullif(current_setting('notesapp.account_id', true), '') as value",
        );
        return result.rows[0]?.value ?? null;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}

/** Builds the port implementation over one open transaction. */
function createTransaction(
  client: pg.PoolClient,
  db: NodePgDatabase,
  actor: Actor,
  workspaceId: string,
): WorkspaceTransaction {
  return {
    async role(accountId: string): Promise<Role | null> {
      assertUuid(accountId, 'the account');
      const rows = await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.accountId, accountId),
          ),
        );
      return rows[0]?.role ?? null;
    },

    async receipt(mutationId: string, accountId: string) {
      assertUuid(mutationId, 'the mutation');
      assertUuid(accountId, 'the account');
      const rows = await db
        .select({
          digest: mutationReceipts.requestDigest,
          outcome: mutationReceipts.outcome,
        })
        .from(mutationReceipts)
        .where(
          and(
            eq(mutationReceipts.workspaceId, workspaceId),
            eq(mutationReceipts.actorAccountId, accountId),
            eq(mutationReceipts.mutationId, mutationId),
          ),
        );
      const row = rows[0];
      if (row === undefined) return null;
      return { digest: row.digest, outcome: parseOutcome(row.outcome) };
    },

    async heads(
      fileIds: readonly string[],
    ): Promise<ReadonlyMap<string, string | null>> {
      const result = new Map<string, string | null>();
      for (const fileId of fileIds) {
        assertUuid(fileId, 'a file');
        result.set(fileId, null);
      }
      if (result.size === 0) return result;
      const rows = await db
        .select({ id: files.id, head: files.headRevisionId })
        .from(files)
        .where(
          and(
            eq(files.workspaceId, workspaceId),
            inArray(files.id, [...result.keys()]),
          ),
        );
      for (const row of rows) result.set(row.id, row.head);
      return result;
    },

    async parents(
      ids: readonly string[],
    ): Promise<ReadonlyMap<string, string>> {
      const result = new Map<string, string>();
      if (ids.length === 0) return result;
      for (const id of ids) assertUuid(id, 'a revision');
      const rows = await db
        .select({ id: revisions.id, fileId: revisions.fileId })
        .from(revisions)
        .where(
          and(
            eq(revisions.workspaceId, workspaceId),
            inArray(revisions.id, [...ids]),
          ),
        );
      for (const row of rows) result.set(row.id, row.fileId);
      return result;
    },

    async isPurged(fileId: string): Promise<boolean> {
      assertUuid(fileId, 'the file');
      const rows = await db
        .select({ fileId: purgeMarkers.fileId })
        .from(purgeMarkers)
        .where(
          and(
            eq(purgeMarkers.workspaceId, workspaceId),
            eq(purgeMarkers.fileId, fileId),
          ),
        );
      return rows.length > 0;
    },

    async accept(
      writer: Actor,
      input: ChangesetInput,
      digest: string,
    ): Promise<Result<AcceptedChangeset>> {
      if (input.workspaceId !== workspaceId) {
        throw new OperationalError(
          'unexpected',
          'notesapp: the changeset belongs to another workspace.',
        );
      }
      if (writer.accountId !== actor.accountId) {
        throw new OperationalError(
          'unexpected',
          'notesapp: the writing actor differs from the transaction actor.',
        );
      }
      if (input.revisions.length === 0) {
        throw new OperationalError(
          'unexpected',
          'notesapp: a changeset must carry at least one revision.',
        );
      }
      const fileIds = [
        ...new Set(input.revisions.map((revision) => revision.fileId)),
      ].sort();
      await client.query('savepoint notesapp_accept');
      try {
        const outcome = await writeChangeset(
          client,
          db,
          writer,
          workspaceId,
          input,
          digest,
          fileIds,
        );
        if (!outcome.ok) {
          await client.query('rollback to savepoint notesapp_accept');
          return outcome;
        }
        await client.query('release savepoint notesapp_accept');
        return outcome;
      } catch (error) {
        await client.query('rollback to savepoint notesapp_accept');
        const mapped = domainFailure(error, fileIds);
        if (mapped !== null) return mapped;
        throw operational(error);
      }
    },
  };
}

/** Performs the atomic write of one validated changeset. */
async function writeChangeset(
  client: pg.PoolClient,
  db: NodePgDatabase,
  actor: Actor,
  workspaceId: string,
  input: ChangesetInput,
  digest: string,
  fileIds: readonly string[],
): Promise<Result<AcceptedChangeset>> {
  assertUuid(input.mutationId, 'the mutation');
  for (const revision of input.revisions) {
    assertUuid(revision.id, 'a revision');
    assertUuid(revision.fileId, 'a file');
    for (const parent of revision.parents) assertUuid(parent, 'a parent');
  }
  const heads = tips(input);

  // Lock every affected file in identifier order, so two changesets that share
  // files cannot deadlock.
  const locked = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(eq(files.workspaceId, workspaceId), inArray(files.id, [...fileIds])),
    )
    .orderBy(files.id)
    .for('update');
  const known = new Set(locked.map((row) => row.id));

  const missing = fileIds.filter((fileId) => !known.has(fileId));
  if (missing.length > 0) {
    await db
      .insert(files)
      .values(
        missing.map((fileId) => {
          const tip = heads.get(fileId);
          if (tip === undefined) {
            throw new OperationalError(
              'unexpected',
              'notesapp: a locked file has no submitted revision.',
            );
          }
          return {
            workspaceId,
            id: fileId,
            path: tip.path,
            kind: tip.content.kind === 'markdown' ? 'note' : 'attachment',
          } as const;
        }),
      )
      .onConflictDoNothing();
  }

  // Attachment content refers to a finalized object of the same workspace.
  const objectIds = [
    ...new Set(
      input.revisions.flatMap((revision) =>
        revision.content.kind === 'attachment'
          ? [revision.content.objectId]
          : [],
      ),
    ),
  ];
  const objectSizes = new Map<string, bigint>();
  if (objectIds.length > 0) {
    for (const objectId of objectIds) assertUuid(objectId, 'an attachment');
    const rows = await db
      .select({
        id: attachmentObjects.id,
        size: attachmentObjects.size,
        state: attachmentObjects.state,
      })
      .from(attachmentObjects)
      .where(
        and(
          eq(attachmentObjects.workspaceId, workspaceId),
          inArray(attachmentObjects.id, objectIds),
        ),
      );
    for (const row of rows) {
      if (row.state === 'finalized') objectSizes.set(row.id, row.size);
    }
    const unusable = input.revisions.filter(
      (revision) =>
        revision.content.kind === 'attachment' &&
        !objectSizes.has(revision.content.objectId),
    );
    if (unusable.length > 0) {
      return fail(
        'invalid_graph',
        unusable.map((revision) => revision.fileId),
      );
    }
  }

  // Immutable content, deduplicated inside this workspace only.
  const contentRows = new Map<
    string,
    {
      workspaceId: string;
      digest: string;
      kind: 'markdown' | 'attachment';
      size: bigint;
      markdown: string | null;
      objectId: string | null;
    }
  >();
  for (const revision of input.revisions) {
    const content = revision.content;
    if (contentRows.has(content.digest)) continue;
    contentRows.set(content.digest, {
      workspaceId,
      digest: content.digest,
      kind: content.kind,
      size:
        content.kind === 'markdown'
          ? BigInt(Buffer.byteLength(content.text, 'utf8'))
          : (objectSizes.get(content.objectId) ?? 0n),
      markdown: content.kind === 'markdown' ? content.text : null,
      objectId: content.kind === 'attachment' ? content.objectId : null,
    });
  }
  const stored = await db
    .insert(contents)
    .values([...contentRows.values()])
    .onConflictDoNothing()
    .returning({ size: contents.size });
  const contentBytes = stored.reduce((total, row) => total + row.size, 0n);

  // Retained metadata and receipts count toward the workspace quota.
  const addedBytes =
    contentBytes +
    BigInt(input.revisions.length) * revisionOverheadBytes +
    receiptOverheadBytes;
  const usageRows = await db
    .select({
      bytesUsed: workspaceUsage.bytesUsed,
      quotaBytes: workspaceUsage.quotaBytes,
    })
    .from(workspaceUsage)
    .where(eq(workspaceUsage.workspaceId, workspaceId))
    .for('update');
  const usage = usageRows[0];
  if (usage === undefined) {
    throw new OperationalError(
      'unexpected',
      'notesapp: the workspace has no usage record.',
    );
  }
  if (
    contentBytes > 0n &&
    usage.bytesUsed + addedBytes > usage.quotaBytes - controlReserveBytes
  ) {
    return fail('quota', fileIds);
  }
  await db
    .update(workspaceUsage)
    .set({ bytesUsed: usage.bytesUsed + addedBytes })
    .where(eq(workspaceUsage.workspaceId, workspaceId));

  // The commit ordered cursor is allocated under the workspace row lock.
  const cursorRows = await db
    .update(workspaceCursors)
    .set({ lastCursor: sql`${workspaceCursors.lastCursor} + 1` })
    .where(eq(workspaceCursors.workspaceId, workspaceId))
    .returning({ cursor: workspaceCursors.lastCursor });
  const cursor = cursorRows[0]?.cursor;
  if (cursor === undefined) {
    throw new OperationalError(
      'unexpected',
      'notesapp: the workspace has no cursor record.',
    );
  }

  const changesetId = randomUUID();
  await db.insert(changesets).values({
    workspaceId,
    id: changesetId,
    mutationId: input.mutationId,
    actorAccountId: actor.accountId,
    deviceId: input.deviceId,
    requestDigest: digest,
    cursor,
  });

  await db.insert(revisions).values(
    input.revisions.map((revision) => ({
      workspaceId,
      id: revision.id,
      fileId: revision.fileId,
      contentDigest: revision.content.digest,
      path: revision.path,
      deleted: revision.deleted,
      changesetId,
      actorAccountId: actor.accountId,
      clientTime: clientTime(revision),
      message: revision.message,
      restoredFrom: revision.restoredFrom,
    })),
  );

  const parentRows = input.revisions.flatMap((revision) =>
    revision.parents.map((parent, ordinal) => ({
      workspaceId,
      childId: revision.id,
      parentId: parent,
      ordinal,
    })),
  );
  if (parentRows.length > 0) {
    await db.insert(revisionParents).values(parentRows);
  }

  // Advance every head in one statement, so a large folder change stays one
  // round trip.
  const headValues = sql.join(
    [...heads.values()].map(
      (tip) =>
        sql`(${tip.fileId}::uuid, ${tip.id}::uuid, ${tip.path}::text, ${tip.deleted}::boolean)`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    update ${files} as f
    set head_revision_id = v.head_revision_id,
        path = v.path,
        deleted = v.deleted,
        updated_at = now()
    from (values ${headValues}) as v(file_id, head_revision_id, path, deleted)
    where f.workspace_id = ${workspaceId}::uuid and f.id = v.file_id
  `);

  // Accepted paths. A deleted file releases its path; a live file claims it.
  // The unique constraint is deferred, so two files can swap paths here.
  const removed = [...heads.values()].filter((tip) => tip.deleted);
  if (removed.length > 0) {
    await db.delete(livePaths).where(
      and(
        eq(livePaths.workspaceId, workspaceId),
        inArray(
          livePaths.fileId,
          removed.map((tip) => tip.fileId),
        ),
      ),
    );
  }
  const claimed = [...heads.values()].filter((tip) => !tip.deleted);
  if (claimed.length > 0) {
    await db
      .insert(livePaths)
      .values(
        claimed.map((tip) => ({
          workspaceId,
          fileId: tip.fileId,
          path: tip.path,
        })),
      )
      .onConflictDoUpdate({
        target: [livePaths.workspaceId, livePaths.fileId],
        set: { path: sql`excluded.path` },
      });
  }

  await db.insert(syncChanges).values(
    [...heads.values()].map((tip) => ({
      workspaceId,
      cursor,
      entityKind: 'file' as const,
      entityId: tip.fileId,
      revisionId: tip.id,
      deleted: tip.deleted,
    })),
  );

  const outcome: AcceptedChangeset = {
    mutationId: input.mutationId,
    revisionIds: input.revisions.map((revision) => revision.id),
    cursor: cursor.toString(),
  };
  await db.insert(mutationReceipts).values({
    workspaceId,
    actorAccountId: actor.accountId,
    mutationId: input.mutationId,
    requestDigest: digest,
    outcome,
  });

  // Force the deferred checks now, so a path conflict is an expected outcome
  // of this call rather than a failure at commit time.
  await client.query('set constraints all immediate');
  await client.query('set constraints all deferred');
  return ok(outcome);
}
