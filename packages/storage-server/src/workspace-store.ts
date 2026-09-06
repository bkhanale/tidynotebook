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
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  OperationalError,
  fail,
  maxPageSize,
  ok,
  snapshotTtlMs,
  type OperationalErrorKind,
  type AcceptedChangeset,
  type AcceptedRevision,
  type Actor,
  type ChangesetInput,
  type FilePage,
  type FileRecord,
  type PageRequest,
  type Result,
  type RevisionInput,
  type RevisionRecord,
  type Role,
  type SnapshotPage,
  type SnapshotStart,
  type StartSnapshotInput,
  type SyncChangeFeed,
  type TransactOptions,
  type WorkspaceTransaction,
  type AcceptedBranch,
  type BlockingReference,
  type BranchFilter,
  type BranchRecord,
  type BranchState,
  type HistoryPage,
  type MutationReceipt,
  type PurgePreview,
  type PurgedFilesResult,
  type SubmitBranchInput,
  type Backlink,
  type SearchHit,
  type CreateShareRecord,
  type PublicShareRecord,
  type ShareRecord,
  type SharingStore,
} from '@notesapp/core';
import {
  extractAttachmentRefs,
  extractLinks,
  parseWikiLink,
} from '@notesapp/markdown';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {
  attachmentObjects,
  branches,
  changesets,
  contents,
  files,
  linkIndex,
  livePaths,
  memberships,
  mutationReceipts,
  purgeMarkers,
  revisionParents,
  revisions,
  searchIndex,
  syncChanges,
  workspaceUsage,
} from './schema.ts';
import {
  captureSnapshot,
  emitSyncRows,
  readSnapshotPage,
  readSyncChanges,
  runSyncCleanup,
} from './snapshots.ts';

/**
 * Bytes charged for the metadata of one accepted revision.
 *
 * The charge covers the revision row, its parent rows, its incremental sync
 * record, and its entry in the stored mutation receipt, which repeats the
 * accepted record so a retry can be answered without a read.
 */
const revisionOverheadBytes = 1024n;

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

/** The SHA-256 digest of UTF-8 Markdown, in lower case hexadecimal. */
function markdownDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

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
export type WorkspaceStoreHandle = SharingStore & {
  /**
   * Removes expired snapshots and change records older than the retention.
   *
   * Revisions, contents, receipts, and purge markers are left alone, so saved
   * history stays valid beyond the event window. Returns how many snapshot
   * rows and change rows were removed.
   */
  cleanupSync(now: Date): Promise<{
    expiredSnapshots: number;
    oldChanges: number;
  }>;
  /**
   * The identity setting of one pooled connection outside a transaction.
   *
   * The value must be `null`. The transaction identity is set with the local
   * flag of `set_config`, so it disappears at commit or rollback and cannot
   * reach the next user of the connection.
   *
   * The call takes whichever connection the pool hands out, so it proves the
   * absence of a leak only at pool size 1, where that is the connection the
   * earlier transaction used.
   */
  readPooledIdentity(): Promise<string | null>;
  /** Closes every pooled connection. */
  close(): Promise<void>;
};

/**
 * The workspace is not available to this actor.
 *
 * The row access policies hide a workspace that the account is not a member
 * of, so storage cannot tell a missing workspace from a hidden one, and it
 * must not try: the answer would disclose that the workspace exists. This is
 * not an infrastructure failure, so it is a separate error. An HTTP adapter
 * maps it to 404.
 */
export class WorkspaceUnavailableError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super('notesapp: the workspace is not available to this actor.');
    this.name = 'WorkspaceUnavailableError';
    this.workspaceId = workspaceId;
  }
}

/**
 * A PostgreSQL failure, reduced to the fields that carry no stored content.
 *
 * `detail`, `hint`, `where`, the statement, and its bound parameters are
 * deliberately absent: PostgreSQL echoes the offending values in `detail`, and
 * the driver keeps the parameters.
 */
type PostgresFailure = {
  readonly code: string;
  readonly constraint: string | null;
  readonly table: string | null;
  readonly routine: string | null;
};

/** Reads the PostgreSQL failure out of a thrown value and its causes. */
function postgresFailure(value: unknown): PostgresFailure | null {
  let current: unknown = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    if ('code' in current && typeof current.code === 'string') {
      return {
        code: current.code,
        constraint:
          'constraint' in current && typeof current.constraint === 'string'
            ? current.constraint
            : null,
        table:
          'table' in current && typeof current.table === 'string'
            ? current.table
            : null,
        routine:
          'routine' in current && typeof current.routine === 'string'
            ? current.routine
            : null,
      };
    }
    if (!('cause' in current)) return null;
    current = current.cause;
  }
  return null;
}

/**
 * A content free description of a database failure.
 *
 * The driver's own error, and the wrapper that Drizzle puts around it, carry
 * the failed statement, its bound parameters, and the PostgreSQL `detail` and
 * `hint` fields. All four echo note text and file paths, and a logger that
 * walks `cause` would write them out. This class therefore becomes the cause
 * of every `OperationalError` that this package throws. It keeps only the
 * SQLSTATE, the constraint, the table, and the server routine.
 */
export class DatabaseFailure extends Error {
  readonly sqlState: string | null;
  readonly constraintName: string | null;
  readonly tableName: string | null;
  readonly routine: string | null;

  constructor(failure: PostgresFailure | null, fallback: string) {
    super(
      failure === null
        ? `notesapp: ${fallback}`
        : `notesapp: PostgreSQL rejected a statement with SQLSTATE ${failure.code}`,
    );
    this.name = 'DatabaseFailure';
    this.sqlState = failure?.code ?? null;
    this.constraintName = failure?.constraint ?? null;
    this.tableName = failure?.table ?? null;
    this.routine = failure?.routine ?? null;
  }
}

/** The name of a thrown value, without any of its content. */
function failureName(value: unknown): string {
  if (value instanceof Error) return value.name;
  return typeof value;
}

/**
 * Failure codes that mean the database cannot be reached or cannot be used.
 *
 * The first four are Node socket codes that the driver reports in the same
 * `code` field as a SQLSTATE. `3D000` is a missing database, `28000` and
 * `28P01` are a refused login, `08*` is a broken connection, and `57P03` is a
 * server that is still starting.
 */
const unavailableCodes = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  '3D000',
  '28000',
  '28P01',
  '57P03',
]);

/** The infrastructure failure kind of one database failure code. */
function failureKind(code: string): OperationalErrorKind {
  if (code === '40001' || code === '40P01') return 'serialization';
  if (code === '57014') return 'timeout';
  if (unavailableCodes.has(code) || code.startsWith('08')) return 'unavailable';
  return 'unexpected';
}

/** Wraps an unexpected failure as an infrastructure failure. */
function operational(value: unknown): OperationalError {
  if (value instanceof OperationalError) return value;
  const failure = postgresFailure(value);
  const kind = failure === null ? 'unexpected' : failureKind(failure.code);
  // The cause is rebuilt, never forwarded, so no statement text, no bound
  // parameter, and no PostgreSQL detail line can reach a log.
  return new OperationalError(kind, 'notesapp: the workspace store failed.', {
    cause: new DatabaseFailure(failure, `a ${failureName(value)} was thrown`),
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
): Result<never> | null {
  const failure = postgresFailure(value);
  if (failure === null) return null;
  const constraint = failure.constraint ?? '';
  if (failure.code === '23505') {
    if (constraint === 'live_paths_path_key')
      return fail<never>('path_conflict', fileIds);
    if (constraint === 'changesets_mutation_key') {
      return fail<never>('mutation_reused', fileIds);
    }
    if (constraint.startsWith('mutation_receipts')) {
      return fail<never>('mutation_reused', fileIds);
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
      return fail<never>('invalid_graph', fileIds);
    }
    return null;
  }
  if (failure.code === '23514' && constraint.startsWith('revision_parents')) {
    return fail<never>('invalid_graph', fileIds);
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

/** Reads one accepted revision record out of a stored outcome. */
function parseAcceptedRevision(value: unknown): AcceptedRevision {
  const record: Record<string, unknown> =
    typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value))
      : {};
  const parents = record.parents;
  if (
    typeof record.revisionId === 'string' &&
    typeof record.fileId === 'string' &&
    Array.isArray(parents) &&
    parents.every((entry: unknown) => typeof entry === 'string') &&
    typeof record.path === 'string' &&
    typeof record.deleted === 'boolean' &&
    typeof record.digest === 'string' &&
    typeof record.size === 'number' &&
    typeof record.actorAccountId === 'string' &&
    typeof record.serverTime === 'string' &&
    (record.message === null || typeof record.message === 'string')
  ) {
    return {
      revisionId: record.revisionId,
      fileId: record.fileId,
      parents: [...parents],
      path: record.path,
      deleted: record.deleted,
      digest: record.digest,
      size: record.size,
      actorAccountId: record.actorAccountId,
      serverTime: record.serverTime,
      message: record.message,
    };
  }
  throw new OperationalError(
    'unexpected',
    'notesapp: a stored accepted revision has an unknown shape.',
  );
}

/** Reads the stored outcome of a mutation receipt. */
function parseOutcome<T = AcceptedChangeset>(value: unknown): T {
  if (
    typeof value === 'object' &&
    value !== null &&
    'mutationId' in value &&
    typeof value.mutationId === 'string' &&
    'cursor' in value &&
    typeof value.cursor === 'string' &&
    'revisionIds' in value &&
    Array.isArray(value.revisionIds) &&
    value.revisionIds.every((entry: unknown) => typeof entry === 'string') &&
    'revisions' in value &&
    Array.isArray(value.revisions)
  ) {
    return {
      mutationId: value.mutationId,
      cursor: value.cursor,
      revisionIds: [...value.revisionIds],
      revisions: value.revisions.map(parseAcceptedRevision),
    } as unknown as T;
  }
  if (typeof value === 'object' && value !== null && 'mutationId' in value) {
    return value as unknown as T;
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

type ShareRow = {
  readonly id: string;
  readonly file_id: string;
  readonly pinned_revision_id: string;
  readonly creator_account_id: string;
  readonly expires_at: Date | null;
  readonly revoked_at: Date | null;
  readonly created_at: Date;
};

/** Maps one private database row to the administrator response shape. */
function shareRecord(row: ShareRow | undefined): ShareRecord {
  if (row === undefined)
    throw new OperationalError(
      'unexpected',
      'notesapp: a stored share write returned no row.',
    );
  return {
    id: row.id,
    fileId: row.file_id,
    pinnedRevisionId: row.pinned_revision_id,
    creatorAccountId: row.creator_account_id,
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/** A case folded title key used only to resolve author written wiki links. */
function titleKey(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
}

/** The full path title and basename title of one Markdown path. */
function titleKeys(path: string): readonly string[] {
  const withoutExtension = path.toLowerCase().endsWith('.md')
    ? path.slice(0, -3)
    : path;
  const basename = withoutExtension.split('/').at(-1) ?? withoutExtension;
  return basename === withoutExtension
    ? [titleKey(withoutExtension)]
    : [titleKey(withoutExtension), titleKey(basename)];
}

/**
 * Replaces the search and backlink rows of every accepted head in this write.
 *
 * This runs after the file heads and paths move, inside the same transaction.
 * A reader can therefore observe either the old head with its old indexes or
 * the new head with its new indexes, but never a mixed state.
 */
async function updateAcceptedIndexes(
  db: NodePgDatabase,
  workspaceId: string,
  acceptedHeads: ReadonlyMap<string, RevisionInput>,
): Promise<void> {
  const fileIds = [...acceptedHeads.keys()];
  if (fileIds.length === 0) return;
  await db
    .delete(linkIndex)
    .where(
      and(
        eq(linkIndex.workspaceId, workspaceId),
        inArray(linkIndex.sourceFileId, fileIds),
      ),
    );
  await db
    .delete(searchIndex)
    .where(
      and(
        eq(searchIndex.workspaceId, workspaceId),
        inArray(searchIndex.fileId, fileIds),
      ),
    );

  const searchable = [...acceptedHeads.values()].filter(
    (tip) => !tip.deleted && tip.content.kind === 'markdown',
  );
  if (searchable.length === 0) return;

  await db.insert(searchIndex).values(
    searchable.map((tip) => ({
      workspaceId,
      fileId: tip.fileId,
      revisionId: tip.id,
      path: tip.path,
      searchText: `${tip.path}\n${tip.content.kind === 'markdown' ? tip.content.text : ''}`,
    })),
  );

  const live = await db
    .select({ id: files.id, path: files.path })
    .from(files)
    .where(
      and(
        eq(files.workspaceId, workspaceId),
        eq(files.kind, 'note'),
        eq(files.deleted, false),
        isNotNull(files.headRevisionId),
      ),
    );
  const liveIds = new Set(live.map((file) => file.id));
  const byTitle = new Map<string, string[]>();
  for (const file of live) {
    for (const key of titleKeys(file.path)) {
      const matches = byTitle.get(key) ?? [];
      if (!matches.includes(file.id)) matches.push(file.id);
      byTitle.set(key, matches);
    }
  }

  const rows = searchable.flatMap((tip) => {
    if (tip.content.kind !== 'markdown') return [];
    return extractLinks(tip.content.text).map((link, ordinal) => {
      let targetFileId: string | null = null;
      if (link.targetId !== null && liveIds.has(link.targetId)) {
        targetFileId = link.targetId;
      } else {
        const wiki = parseWikiLink(link.source);
        const candidates =
          wiki === null ? [] : (byTitle.get(titleKey(wiki.title)) ?? []);
        if (candidates.length === 1) targetFileId = candidates[0] ?? null;
      }
      return {
        workspaceId,
        sourceFileId: tip.fileId,
        sourceRevisionId: tip.id,
        ordinal,
        targetFileId,
        sourceText: link.source,
      };
    });
  });
  if (rows.length > 0) await db.insert(linkIndex).values(rows);
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
    async readPublicShare(
      tokenHash: string,
    ): Promise<PublicShareRecord | null> {
      if (!/^[0-9a-f]{64}$/.test(tokenHash)) return null;
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        throw operational(error);
      }
      try {
        const result = await client.query<{
          workspace_id: string;
          share_id: string;
          file_id: string;
          pinned_revision_id: string;
          allowed_attachment_revision_ids: string[];
          path: string;
          markdown: string | null;
        }>('select * from public.notesapp_share_lookup($1)', [tokenHash]);
        const row = result.rows[0];
        if (row === undefined || row.markdown === null) return null;
        return {
          shareId: row.share_id,
          workspaceId: row.workspace_id,
          fileId: row.file_id,
          pinnedRevisionId: row.pinned_revision_id,
          path: row.path,
          markdown: row.markdown,
          allowedAttachmentRevisionIds:
            row.allowed_attachment_revision_ids ?? [],
        };
      } catch (error) {
        throw operational(error);
      } finally {
        client.release();
      }
    },

    async transact<T>(
      actor: Actor,
      workspaceId: string,
      run: (tx: WorkspaceTransaction) => Promise<T>,
      options: TransactOptions = {},
    ): Promise<T> {
      assertUuid(actor.accountId, 'the actor account');
      assertUuid(workspaceId, 'the workspace');
      // A refused connection must not escape as a driver error: its message
      // repeats the host, the port, and the role of the connection URL.
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        throw operational(error);
      }
      try {
        const db = drizzle({ client });
        await client.query('begin');
        try {
          // A snapshot capture reads the files and the high-water cursor from
          // one stable view, so concurrent commits land after its cursor.
          if (options.isolation === 'repeatable-read') {
            await client.query(
              'set transaction isolation level repeatable read',
            );
          }
          await client.query(
            "select set_config('notesapp.account_id', $1, true)",
            [actor.accountId],
          );
          // The workspace lock orders every write of one workspace, so the
          // commit ordered cursor cannot skip a transaction that commits late.
          // It is an advisory lock, not `SELECT ... FOR UPDATE`, because a
          // viewer holds no UPDATE right on the workspace row. A hash
          // collision between two workspaces costs extra serialization only.
          await client.query(
            'select pg_advisory_xact_lock(hashtext($1::text)::bigint)',
            [workspaceId],
          );
          const seen = await client.query<{ id: string }>(
            'select id from workspaces where id = $1',
            [workspaceId],
          );
          if (seen.rowCount === 0) {
            throw new WorkspaceUnavailableError(workspaceId);
          }
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
          // Only a database failure becomes an infrastructure failure. A value
          // that the callback threw for its own reasons travels unchanged, so
          // a use case above this port keeps its own error type.
          if (error instanceof OperationalError) throw error;
          if (postgresFailure(error) !== null) throw operational(error);
          throw error;
        }
      } finally {
        client.release();
      }
    },

    async cleanupSync(
      now: Date,
    ): Promise<{ expiredSnapshots: number; oldChanges: number }> {
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        throw operational(error);
      }
      try {
        return await runSyncCleanup(client, now);
      } catch (error) {
        throw operational(error);
      } finally {
        client.release();
      }
    },

    async readPooledIdentity(): Promise<string | null> {
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

    async receipt<T = AcceptedChangeset>(
      mutationId: string,
      accountId: string,
    ): Promise<MutationReceipt<T> | null> {
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
      return { digest: row.digest, outcome: parseOutcome<T>(row.outcome) };
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

    async purgedFiles(fileIds: readonly string[]): Promise<readonly string[]> {
      if (fileIds.length === 0) return [];
      for (const fileId of fileIds) assertUuid(fileId, 'a file');
      const rows = await db
        .select({ fileId: purgeMarkers.fileId })
        .from(purgeMarkers)
        .where(
          and(
            eq(purgeMarkers.workspaceId, workspaceId),
            inArray(purgeMarkers.fileId, [...fileIds]),
          ),
        );
      return rows.map((row) => row.fileId);
    },

    async listFiles(page: PageRequest): Promise<FilePage> {
      // One row more than the page is read, so the answer knows whether a next
      // page exists without a second count query.
      const limit = Math.min(Math.max(1, Math.trunc(page.limit)), maxPageSize);
      if (page.cursor !== null) assertUuid(page.cursor, 'the page cursor');
      const rows = await db
        .select({
          id: files.id,
          path: files.path,
          kind: files.kind,
          head: files.headRevisionId,
          deleted: files.deleted,
          updatedAt: files.updatedAt,
        })
        .from(files)
        .where(
          and(
            eq(files.workspaceId, workspaceId),
            eq(files.deleted, false),
            isNotNull(files.headRevisionId),
            page.cursor === null ? undefined : gt(files.id, page.cursor),
          ),
        )
        .orderBy(files.id)
        .limit(limit + 1);
      const wanted = rows.slice(0, limit);
      return {
        files: wanted.map((row) => ({
          fileId: row.id,
          path: row.path,
          kind: row.kind,
          headRevisionId: row.head,
          deleted: row.deleted,
          updatedAt: row.updatedAt.toISOString(),
        })),
        nextCursor: rows.length > limit ? (wanted.at(-1)?.id ?? null) : null,
      };
    },

    async file(fileId: string): Promise<FileRecord | null> {
      assertUuid(fileId, 'the file');
      const rows = await db
        .select({
          id: files.id,
          path: files.path,
          kind: files.kind,
          head: files.headRevisionId,
          deleted: files.deleted,
          updatedAt: files.updatedAt,
        })
        .from(files)
        .where(and(eq(files.workspaceId, workspaceId), eq(files.id, fileId)));
      const row = rows[0];
      if (row === undefined) return null;
      return {
        fileId: row.id,
        path: row.path,
        kind: row.kind,
        headRevisionId: row.head,
        deleted: row.deleted,
        updatedAt: row.updatedAt.toISOString(),
      };
    },

    async revision(revisionId: string): Promise<RevisionRecord | null> {
      assertUuid(revisionId, 'the revision');
      const rows = await db
        .select({
          id: revisions.id,
          fileId: revisions.fileId,
          path: revisions.path,
          deleted: revisions.deleted,
          digest: revisions.contentDigest,
          message: revisions.message,
          restoredFrom: revisions.restoredFrom,
          clientTime: revisions.clientTime,
          serverTime: revisions.serverTime,
          kind: contents.kind,
          size: contents.size,
          markdown: contents.markdown,
          objectId: contents.objectId,
        })
        .from(revisions)
        .innerJoin(
          contents,
          and(
            eq(contents.workspaceId, revisions.workspaceId),
            eq(contents.digest, revisions.contentDigest),
          ),
        )
        .where(
          and(
            eq(revisions.workspaceId, workspaceId),
            eq(revisions.id, revisionId),
          ),
        );
      const row = rows[0];
      if (row === undefined) return null;
      const parentRows = await db
        .select({ parentId: revisionParents.parentId })
        .from(revisionParents)
        .where(
          and(
            eq(revisionParents.workspaceId, workspaceId),
            eq(revisionParents.childId, revisionId),
          ),
        )
        .orderBy(revisionParents.ordinal);
      return {
        revisionId: row.id,
        fileId: row.fileId,
        path: row.path,
        kind: row.kind === 'markdown' ? 'note' : 'attachment',
        deleted: row.deleted,
        parents: parentRows.map((parent) => parent.parentId),
        digest: row.digest,
        size: Number(row.size),
        text: row.markdown,
        objectId: row.objectId,
        message: row.message,
        restoredFrom: row.restoredFrom,
        clientTime: row.clientTime.toISOString(),
        serverTime: row.serverTime.toISOString(),
      };
    },

    async search(query: string, limit: number): Promise<readonly SearchHit[]> {
      const result = await client.query<{
        file_id: string;
        path: string;
        revision_id: string;
        excerpt: string;
      }>(
        `select file_id, path, revision_id,
                left(replace(replace(
                  ts_headline('simple', search_text,
                    websearch_to_tsquery('simple', $2),
                    'MaxWords=30, MinWords=8, ShortWord=2'),
                  '<b>', ''), '</b>', ''), 1024) as excerpt
           from public.search_index
          where workspace_id = $1
            and to_tsvector('simple', search_text)
                @@ websearch_to_tsquery('simple', $2)
          order by ts_rank_cd(
                     to_tsvector('simple', search_text),
                     websearch_to_tsquery('simple', $2)
                   ) desc,
                   path,
                   file_id
          limit $3`,
        [workspaceId, query, limit],
      );
      return result.rows.map((row) => ({
        fileId: row.file_id,
        path: row.path,
        revisionId: row.revision_id,
        excerpt: row.excerpt,
      }));
    },

    async backlinks(
      fileId: string,
      limit: number,
    ): Promise<readonly Backlink[]> {
      assertUuid(fileId, 'the backlink target');
      const result = await client.query<{
        file_id: string;
        path: string;
        revision_id: string;
        excerpt: string;
        source_text: string;
      }>(
        `select source.id as file_id,
                source.path,
                links.source_revision_id as revision_id,
                left(content.markdown, 240) as excerpt,
                links.source_text
           from public.link_index links
           join public.files source
             on source.workspace_id = links.workspace_id
            and source.id = links.source_file_id
            and source.head_revision_id = links.source_revision_id
            and source.deleted = false
           join public.revisions revision
             on revision.workspace_id = links.workspace_id
            and revision.id = links.source_revision_id
           join public.contents content
             on content.workspace_id = revision.workspace_id
            and content.digest = revision.content_digest
          where links.workspace_id = $1
            and links.target_file_id = $2
          order by source.path, source.id, links.ordinal
          limit $3`,
        [workspaceId, fileId, limit],
      );
      return result.rows.map((row) => ({
        fileId: row.file_id,
        path: row.path,
        revisionId: row.revision_id,
        excerpt: row.excerpt,
        sourceText: row.source_text,
      }));
    },

    async isAcceptedRevision(
      fileId: string,
      revisionId: string,
    ): Promise<boolean> {
      assertUuid(fileId, 'the shared file');
      assertUuid(revisionId, 'the shared revision');
      const result = await client.query<{ accepted: boolean }>(
        `with recursive accepted(id) as (
           select head_revision_id
             from public.files
            where workspace_id = $1 and id = $2 and deleted = false
           union
           select parent.parent_id
             from accepted current
             join public.revision_parents parent
               on parent.workspace_id = $1 and parent.child_id = current.id
         )
         select exists(
           select 1 from accepted where id = $3
         ) as accepted`,
        [workspaceId, fileId, revisionId],
      );
      return result.rows[0]?.accepted ?? false;
    },

    async createShare(input: CreateShareRecord): Promise<ShareRecord> {
      assertUuid(input.id, 'the share');
      const revision = await this.revision(input.pinnedRevisionId);
      const allowed =
        revision?.text === null || revision?.text === undefined
          ? []
          : [
              ...new Set(
                extractAttachmentRefs(revision.text).map(
                  (reference) => reference.revisionId,
                ),
              ),
            ];
      const result = await client.query<ShareRow>(
        `insert into public.shares
           (workspace_id, id, file_id, pinned_revision_id, token_hash,
            allowed_attachment_revision_ids, creator_account_id, expires_at)
         values ($1, $2, $3, $4, $5, $6::uuid[], $7, $8::timestamptz)
         returning id, file_id, pinned_revision_id, creator_account_id,
                   expires_at, revoked_at, created_at`,
        [
          workspaceId,
          input.id,
          input.fileId,
          input.pinnedRevisionId,
          input.tokenHash,
          allowed,
          input.creatorAccountId,
          input.expiresAt,
        ],
      );
      await emitSyncRows(client, {
        workspaceId,
        entries: [
          {
            entityKind: 'share',
            entityId: input.id,
            revisionId: input.pinnedRevisionId,
            deleted: false,
          },
        ],
      });
      return shareRecord(result.rows[0]);
    },

    async updateShare(
      shareId: string,
      fileId: string,
      pinnedRevisionId: string,
      expiresAt: string | null,
    ): Promise<ShareRecord | null> {
      assertUuid(shareId, 'the share');
      const revision = await this.revision(pinnedRevisionId);
      const allowed =
        revision?.text === null || revision?.text === undefined
          ? []
          : [
              ...new Set(
                extractAttachmentRefs(revision.text).map(
                  (reference) => reference.revisionId,
                ),
              ),
            ];
      const result = await client.query<ShareRow>(
        `update public.shares
            set pinned_revision_id = $4,
                allowed_attachment_revision_ids = $5::uuid[],
                expires_at = $6::timestamptz
          where workspace_id = $1 and id = $2 and file_id = $3
            and revoked_at is null
        returning id, file_id, pinned_revision_id, creator_account_id,
                  expires_at, revoked_at, created_at`,
        [workspaceId, shareId, fileId, pinnedRevisionId, allowed, expiresAt],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      await emitSyncRows(client, {
        workspaceId,
        entries: [
          {
            entityKind: 'share',
            entityId: shareId,
            revisionId: pinnedRevisionId,
            deleted: false,
          },
        ],
      });
      return shareRecord(row);
    },

    async revokeShare(shareId: string): Promise<ShareRecord | null> {
      assertUuid(shareId, 'the share');
      const result = await client.query<ShareRow>(
        `update public.shares set revoked_at = now()
          where workspace_id = $1 and id = $2 and revoked_at is null
        returning id, file_id, pinned_revision_id, creator_account_id,
                  expires_at, revoked_at, created_at`,
        [workspaceId, shareId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      await emitSyncRows(client, {
        workspaceId,
        entries: [
          {
            entityKind: 'share',
            entityId: shareId,
            revisionId: null,
            deleted: true,
          },
        ],
      });
      return shareRecord(row);
    },

    async listShares(): Promise<readonly ShareRecord[]> {
      const result = await client.query<ShareRow>(
        `select id, file_id, pinned_revision_id, creator_account_id,
                expires_at, revoked_at, created_at
           from public.shares
          where workspace_id = $1
          order by created_at desc, id`,
        [workspaceId],
      );
      return result.rows.map(shareRecord);
    },

    async onFilesDeleted(fileIds: readonly string[]): Promise<void> {
      if (fileIds.length === 0) return;
      for (const fileId of fileIds) assertUuid(fileId, 'a file');
      const ids = [...fileIds];
      // A share of a deleted file is revoked, not removed, so the audit trail
      // of the publication survives the deletion.
      let revoked: { id: string }[];
      try {
        const result = await client.query<{ id: string }>(
          `update shares set revoked_at = now()
            where workspace_id = $1 and file_id = any($2::uuid[]) and revoked_at is null
            returning id`,
          [workspaceId, ids],
        );
        revoked = result.rows;
      } catch (error) {
        throw operational(error);
      }
      if (revoked.length > 0) {
        // The revocation is part of the deleting commit, so it joins the same
        // ordered stream under the workspace lock that this transaction holds.
        try {
          await emitSyncRows(client, {
            workspaceId,
            entries: revoked.map((share) => ({
              entityKind: 'share' as const,
              entityId: share.id,
              revisionId: null,
              deleted: true,
            })),
          });
        } catch (error) {
          throw operational(error);
        }
      }
      // The file leaves the link index, so it disappears from backlinks and
      // from normal search. The search task adds its own rows to this call.
      await db
        .delete(linkIndex)
        .where(
          and(
            eq(linkIndex.workspaceId, workspaceId),
            inArray(linkIndex.sourceFileId, ids),
          ),
        );
      await db
        .delete(searchIndex)
        .where(
          and(
            eq(searchIndex.workspaceId, workspaceId),
            inArray(searchIndex.fileId, ids),
          ),
        );
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

    async listHistory(fileId: string, page: PageRequest): Promise<HistoryPage> {
      assertUuid(fileId, 'the file');
      const limit = Math.max(1, Math.min(page.limit, maxPageSize));

      let cursorCondition = sql`true`;
      if (page.cursor !== null && page.cursor !== '') {
        assertUuid(page.cursor, 'the cursor');
        cursorCondition = sql`(${revisions.serverTime}, ${revisions.id}) < (
          SELECT r_cur.server_time, r_cur.id FROM ${revisions} r_cur
          WHERE r_cur.workspace_id = ${workspaceId}::uuid AND r_cur.id = ${page.cursor}::uuid
        )`;
      }

      const rows = await db
        .select({
          id: revisions.id,
          fileId: revisions.fileId,
          path: revisions.path,
          deleted: revisions.deleted,
          contentDigest: revisions.contentDigest,
          actorAccountId: revisions.actorAccountId,
          clientTime: revisions.clientTime,
          serverTime: revisions.serverTime,
          message: revisions.message,
          restoredFrom: revisions.restoredFrom,
          size: contents.size,
          markdown: contents.markdown,
          objectId: contents.objectId,
        })
        .from(revisions)
        .innerJoin(
          contents,
          and(
            eq(contents.workspaceId, revisions.workspaceId),
            eq(contents.digest, revisions.contentDigest),
          ),
        )
        .where(
          and(
            eq(revisions.workspaceId, workspaceId),
            eq(revisions.fileId, fileId),
            cursorCondition,
          ),
        )
        .orderBy(sql`${revisions.serverTime} DESC`, sql`${revisions.id} DESC`)
        .limit(limit + 1);

      const wanted = rows.slice(0, limit);
      const revIds = wanted.map((r) => r.id);

      const parentsByChild = new Map<string, string[]>();
      if (revIds.length > 0) {
        const parentRows = await db
          .select({
            childId: revisionParents.childId,
            parentId: revisionParents.parentId,
            ordinal: revisionParents.ordinal,
          })
          .from(revisionParents)
          .where(
            and(
              eq(revisionParents.workspaceId, workspaceId),
              inArray(revisionParents.childId, revIds),
            ),
          )
          .orderBy(revisionParents.ordinal);
        for (const p of parentRows) {
          const list = parentsByChild.get(p.childId) ?? [];
          list.push(p.parentId);
          parentsByChild.set(p.childId, list);
        }
      }

      return {
        revisions: wanted.map((row) => ({
          revisionId: row.id,
          fileId: row.fileId,
          path: row.path,
          deleted: row.deleted,
          parents: parentsByChild.get(row.id) ?? [],
          digest: row.contentDigest,
          size: Number(row.size),
          actorAccountId: row.actorAccountId,
          clientTime: row.clientTime.toISOString(),
          serverTime: row.serverTime.toISOString(),
          message: row.message,
          isCheckpoint: row.message !== null,
          checkpointName: row.message,
          restoredFrom: row.restoredFrom,
          text: row.markdown,
          objectId: row.objectId,
        })),
        nextCursor: rows.length > limit ? (wanted.at(-1)?.id ?? null) : null,
      };
    },

    async listBranches(
      filter?: BranchFilter,
    ): Promise<readonly BranchRecord[]> {
      const conditions = [eq(branches.workspaceId, workspaceId)];
      if (filter?.fileId) {
        assertUuid(filter.fileId, 'the file');
        conditions.push(eq(branches.fileId, filter.fileId));
      }
      if (filter?.conflictGroupId) {
        assertUuid(filter.conflictGroupId, 'the conflict group');
        conditions.push(eq(branches.conflictGroupId, filter.conflictGroupId));
      }
      if (filter?.state) {
        conditions.push(eq(branches.state, filter.state));
      }
      const rows = await db
        .select({
          id: branches.id,
          workspaceId: branches.workspaceId,
          fileId: branches.fileId,
          baseRevisionId: branches.baseRevisionId,
          tipRevisionId: branches.tipRevisionId,
          conflictGroupId: branches.conflictGroupId,
          state: branches.state,
          createdAt: branches.createdAt,
        })
        .from(branches)
        .where(and(...conditions))
        .orderBy(branches.createdAt);

      return rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        fileId: r.fileId,
        baseRevisionId: r.baseRevisionId,
        tipRevisionId: r.tipRevisionId,
        conflictGroupId: r.conflictGroupId,
        state: r.state as BranchState,
        createdAt: r.createdAt.toISOString(),
      }));
    },

    async markBranchesResolved(
      branchTipRevisionIds: readonly string[],
    ): Promise<readonly string[]> {
      if (branchTipRevisionIds.length === 0) return [];
      for (const id of branchTipRevisionIds) {
        assertUuid(id, 'the branch tip');
      }
      const result = await client.query<{ id: string }>(
        `UPDATE public.branches
         SET state = 'resolved'
         WHERE workspace_id = $1
           AND tip_revision_id = ANY($2::uuid[])
           AND state = 'unresolved'
         RETURNING id`,
        [workspaceId, [...branchTipRevisionIds]],
      );
      return result.rows.map((r) => r.id);
    },

    async acceptBranch(
      writer: Actor,
      input: SubmitBranchInput,
      digest: string,
    ): Promise<Result<AcceptedBranch>> {
      if (input.workspaceId !== workspaceId) {
        throw new OperationalError(
          'unexpected',
          'notesapp: the branch belongs to another workspace.',
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
          'notesapp: a branch must carry at least one revision.',
        );
      }
      const fileIds = [
        ...new Set(input.revisions.map((revision) => revision.fileId)),
      ].sort();
      await client.query('savepoint notesapp_accept_branch');
      try {
        const outcome = await writeBranch(
          client,
          db,
          writer,
          workspaceId,
          input,
          digest,
          fileIds,
        );
        if (!outcome.ok) {
          await client.query('rollback to savepoint notesapp_accept_branch');
          return outcome;
        }
        await client.query('release savepoint notesapp_accept_branch');
        return outcome;
      } catch (error) {
        await client.query('rollback to savepoint notesapp_accept_branch');
        const mapped = domainFailure(error, fileIds);
        if (mapped !== null) return mapped;
        throw operational(error);
      }
    },

    async previewPurge(
      fileIds: readonly string[],
    ): Promise<Result<PurgePreview>> {
      if (fileIds.length === 0) {
        return ok({
          fileIds: [],
          revisionIds: [],
          contentDigests: [],
          attachmentObjectIds: [],
          blockingReferences: [],
          dependentRevisionCount: 0,
          reclaimableBytes: 0,
          canPurge: true,
        });
      }
      for (const fileId of fileIds) assertUuid(fileId, 'the file');
      const result = await client.query<{
        file_ids: string[];
        revision_ids: string[];
        content_digests: string[];
        attachment_object_ids: string[];
        blocking_kind: string[];
        blocking_target_id: string[];
        blocking_referrer_id: string[];
        blocking_description: string[];
      }>('SELECT * FROM public.notesapp_preview_purge($1, $2)', [
        workspaceId,
        [...fileIds],
      ]);
      const row = result.rows[0];
      if (!row) {
        return ok({
          fileIds: [],
          revisionIds: [],
          contentDigests: [],
          attachmentObjectIds: [],
          blockingReferences: [],
          dependentRevisionCount: 0,
          reclaimableBytes: 0,
          canPurge: true,
        });
      }
      const blockingReferences: BlockingReference[] = [];
      const count = row.blocking_kind?.length ?? 0;
      for (let i = 0; i < count; i++) {
        blockingReferences.push({
          kind: row.blocking_kind[i] as 'revision' | 'branch' | 'share',
          targetId: row.blocking_target_id[i] ?? '',
          referrerId: row.blocking_referrer_id[i] ?? '',
          description: row.blocking_description[i] ?? '',
        });
      }

      let reclaimableBytes = (row.file_ids?.length ?? 0) * 512;
      if (row.content_digests && row.content_digests.length > 0) {
        const reclaimResult = await client.query<{ bytes: string }>(
          `SELECT coalesce(sum(size), 0) as bytes
           FROM public.contents c
           WHERE c.workspace_id = $1
             AND c.digest = ANY($2::text[])
             AND NOT EXISTS (
               SELECT 1 FROM public.revisions r
               WHERE r.workspace_id = $1
                 AND r.content_digest = c.digest
                 AND NOT (r.file_id = ANY($3::uuid[]))
             )`,
          [workspaceId, row.content_digests, row.file_ids ?? []],
        );
        reclaimableBytes += Number(reclaimResult.rows[0]?.bytes ?? 0);
      }

      return ok({
        fileIds: row.file_ids ?? [],
        revisionIds: row.revision_ids ?? [],
        contentDigests: row.content_digests ?? [],
        attachmentObjectIds: row.attachment_object_ids ?? [],
        blockingReferences,
        dependentRevisionCount: row.revision_ids?.length ?? 0,
        reclaimableBytes,
        canPurge: blockingReferences.length === 0,
      });
    },

    async purgeFiles(
      purger: Actor,
      mutationId: string,
      fileIds: readonly string[],
      digest: string,
    ): Promise<Result<PurgedFilesResult>> {
      assertUuid(mutationId, 'the mutation');
      for (const fileId of fileIds) assertUuid(fileId, 'the file');

      const existingReceipt = await client.query<{
        request_digest: string;
        outcome: PurgedFilesResult;
      }>(
        'SELECT request_digest, outcome FROM mutation_receipts WHERE workspace_id = $1 AND actor_account_id = $2 AND mutation_id = $3',
        [workspaceId, purger.accountId, mutationId],
      );
      const existing = existingReceipt.rows[0];
      if (existing !== undefined) {
        if (existing.request_digest === digest) {
          return ok(existing.outcome);
        }
        return fail('mutation_reused', fileIds);
      }

      try {
        // A purge removes revisions that a live snapshot may pin. Their items
        // are removed first, so the foreign key holds; the snapshot then fails
        // its item count check and its readers restart with a fresh one.
        const pinned = await client.query<{ id: string }>(
          'select id from revisions where workspace_id = $1 and file_id = any($2::uuid[])',
          [workspaceId, [...fileIds]],
        );
        if (pinned.rows.length > 0) {
          await client.query(
            'delete from snapshot_items where workspace_id = $1 and revision_id = any($2::uuid[])',
            [workspaceId, pinned.rows.map((revision) => revision.id)],
          );
        }
        const res = await client.query<{
          purged_file_ids: string[];
          purged_revision_ids: string[];
          reclaimed_bytes: string;
          unreferenced_object_ids: string[];
        }>('SELECT * FROM public.notesapp_purge_files($1, $2)', [
          workspaceId,
          [...fileIds],
        ]);
        const row = res.rows[0];
        const purgedFileIds = row?.purged_file_ids ?? [];
        const purgedRevisionIds = row?.purged_revision_ids ?? [];
        const reclaimedBytes = Number(row?.reclaimed_bytes ?? 0);

        // The permanent deletion joins the ordered sync stream under the
        // workspace lock, so a sync client learns to drop the file.
        if (purgedFileIds.length > 0) {
          await emitSyncRows(client, {
            workspaceId,
            entries: purgedFileIds.map((fileId) => ({
              entityKind: 'file' as const,
              entityId: fileId,
              revisionId: null,
              deleted: true,
            })),
          });
        }

        const outcome: PurgedFilesResult = {
          mutationId,
          purgedFileIds,
          purgedRevisionIds,
          reclaimedBytes,
        };

        await db.insert(mutationReceipts).values({
          workspaceId,
          actorAccountId: purger.accountId,
          mutationId,
          requestDigest: digest,
          outcome,
        });

        return ok(outcome);
      } catch (error) {
        const failure = postgresFailure(error);
        if (failure?.code === '23503') {
          return fail('invalid_content', fileIds);
        }
        if (failure?.code === '42501') {
          return fail('forbidden');
        }
        throw operational(error);
      }
    },

    async startSnapshot(input: StartSnapshotInput): Promise<SnapshotStart> {
      if (!Number.isInteger(input.pageSize) || input.pageSize < 1) {
        throw new OperationalError(
          'unexpected',
          'notesapp: the snapshot page size is outside the served range.',
        );
      }
      try {
        return await captureSnapshot(client, {
          workspaceId,
          accountId: actor.accountId,
          pageSize: input.pageSize,
          now: new Date(),
          ttlMs: snapshotTtlMs,
        });
      } catch (error) {
        throw operational(error);
      }
    },

    async snapshotPage(
      token: string,
      position: number,
      limit: number,
    ): Promise<SnapshotPage | null> {
      if (
        !Number.isInteger(position) ||
        position < 0 ||
        !Number.isInteger(limit) ||
        limit < 1
      ) {
        throw new OperationalError(
          'unexpected',
          'notesapp: the snapshot page range is outside the served range.',
        );
      }
      try {
        return await readSnapshotPage(client, {
          workspaceId,
          token,
          position,
          limit,
          now: new Date(),
        });
      } catch (error) {
        throw operational(error);
      }
    },

    async syncChanges(
      afterCursor: string,
      limit: number,
    ): Promise<SyncChangeFeed> {
      if (!/^[0-9]{1,32}$/.test(afterCursor)) {
        throw new OperationalError(
          'unexpected',
          'notesapp: the sync cursor is not a decimal string.',
        );
      }
      if (!Number.isInteger(limit) || limit < 1) {
        throw new OperationalError(
          'unexpected',
          'notesapp: the sync limit is outside the served range.',
        );
      }
      try {
        return await readSyncChanges(client, {
          workspaceId,
          afterCursor,
          limit,
        });
      } catch (error) {
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
  const objects = new Map<string, { size: bigint; digest: string }>();
  if (objectIds.length > 0) {
    for (const objectId of objectIds) assertUuid(objectId, 'an attachment');
    const rows = await db
      .select({
        id: attachmentObjects.id,
        size: attachmentObjects.size,
        digest: attachmentObjects.digest,
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
      if (row.state === 'finalized') {
        objects.set(row.id, { size: row.size, digest: row.digest });
      }
    }
    const unusable = input.revisions.filter(
      (revision) =>
        revision.content.kind === 'attachment' &&
        !objects.has(revision.content.objectId),
    );
    if (unusable.length > 0) {
      return fail(
        'invalid_graph',
        unusable.map((revision) => revision.fileId),
      );
    }
  }

  // The declared digest must match the submitted bytes. A wrong digest would
  // attach the revision to content that the client never sent, because content
  // is addressed by digest and deduplicated.
  const mismatched = input.revisions.filter((revision) => {
    const content = revision.content;
    if (content.kind === 'markdown') {
      return markdownDigest(content.text) !== content.digest.toLowerCase();
    }
    return objects.get(content.objectId)?.digest !== content.digest;
  });
  if (mismatched.length > 0) {
    return fail(
      'invalid_content',
      mismatched.map((revision) => revision.fileId),
    );
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
          : (objects.get(content.objectId)?.size ?? 0n),
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
    .where(eq(workspaceUsage.workspaceId, workspaceId));
  const usage = usageRows[0];
  if (usage === undefined) {
    throw new OperationalError(
      'unexpected',
      'notesapp: the workspace has no usage record.',
    );
  }
  // Only a changeset that deletes every file it touches and adds no content
  // byte may use the control reserve. A deletion that carried new content
  // would otherwise reach the reserved capacity through a disguised write, and
  // the reserve exists so that a full workspace can still be managed by
  // operations that add nothing. Reusing a stored digest is not enough on its
  // own either: the revision rows and the receipt still grow the retained
  // bytes, so a changeset that keeps a file alive must fit under the reserve
  // line like any other write.
  const control =
    contentBytes === 0n &&
    input.revisions.every((revision) => revision.deleted);
  const limit = control
    ? usage.quotaBytes
    : usage.quotaBytes - controlReserveBytes;
  if (usage.bytesUsed + addedBytes > limit) {
    return fail('quota', fileIds);
  }
  // The runtime role holds no UPDATE right on the usage or the cursor record,
  // so both changes go through a membership checked function of the schema
  // owner. A member can therefore not raise its own quota or reset the commit
  // order.
  await client.query('select notesapp_add_usage($1, $2::bigint)', [
    workspaceId,
    addedBytes.toString(),
  ]);
  const allocated = await client.query<{ cursor: string }>(
    'select notesapp_next_cursor($1) as cursor',
    [workspaceId],
  );
  const allocatedCursor = allocated.rows[0]?.cursor;
  if (allocatedCursor === undefined) {
    throw new OperationalError(
      'unexpected',
      'notesapp: the workspace cursor was not allocated.',
    );
  }
  const cursor = BigInt(allocatedCursor);

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

  // The acceptance time is assigned by the database, so it is read back here:
  // the answer to a write is built from the accepted rows, never from a later
  // read that would need the read permission the writer may not hold.
  const written = await db
    .insert(revisions)
    .values(
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
    )
    .returning({ id: revisions.id, serverTime: revisions.serverTime });
  const serverTimes = new Map(
    written.map((row) => [row.id, row.serverTime.toISOString()]),
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

  await updateAcceptedIndexes(db, workspaceId, heads);

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
    revisions: input.revisions.map((revision) => {
      const serverTime = serverTimes.get(revision.id);
      if (serverTime === undefined) {
        throw new OperationalError(
          'unexpected',
          'notesapp: an accepted revision was not written back.',
        );
      }
      return {
        revisionId: revision.id,
        fileId: revision.fileId,
        parents: [...revision.parents],
        path: revision.path,
        deleted: revision.deleted,
        digest: revision.content.digest,
        size: Number(contentRows.get(revision.content.digest)?.size ?? 0n),
        actorAccountId: actor.accountId,
        serverTime,
        message: revision.message,
      };
    }),
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

/** Performs the atomic write of one validated branch submission. */
async function writeBranch(
  client: pg.PoolClient,
  db: NodePgDatabase,
  actor: Actor,
  workspaceId: string,
  input: SubmitBranchInput,
  digest: string,
  fileIds: readonly string[],
): Promise<Result<AcceptedBranch>> {
  assertUuid(input.mutationId, 'the mutation');
  assertUuid(input.conflictGroupId, 'the conflict group');
  for (const revision of input.revisions) {
    assertUuid(revision.id, 'a revision');
    assertUuid(revision.fileId, 'a file');
    for (const parent of revision.parents) assertUuid(parent, 'a parent');
  }

  const branchTips = tips(input);

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
          const tip = branchTips.get(fileId);
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
            headRevisionId: null,
            deleted: false,
          } as const;
        }),
      )
      .onConflictDoNothing();
  }

  const objectIds = [
    ...new Set(
      input.revisions.flatMap((revision) =>
        revision.content.kind === 'attachment'
          ? [revision.content.objectId]
          : [],
      ),
    ),
  ];
  const objects = new Map<string, { size: bigint; digest: string }>();
  if (objectIds.length > 0) {
    for (const objectId of objectIds) assertUuid(objectId, 'an attachment');
    const rows = await db
      .select({
        id: attachmentObjects.id,
        size: attachmentObjects.size,
        digest: attachmentObjects.digest,
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
      if (row.state === 'finalized') {
        objects.set(row.id, { size: row.size, digest: row.digest });
      }
    }
    const unusable = input.revisions.filter(
      (revision) =>
        revision.content.kind === 'attachment' &&
        !objects.has(revision.content.objectId),
    );
    if (unusable.length > 0) {
      return fail(
        'invalid_graph',
        unusable.map((revision) => revision.fileId),
      );
    }
  }

  const mismatched = input.revisions.filter((revision) => {
    const content = revision.content;
    if (content.kind === 'markdown') {
      return markdownDigest(content.text) !== content.digest.toLowerCase();
    }
    return objects.get(content.objectId)?.digest !== content.digest;
  });
  if (mismatched.length > 0) {
    return fail(
      'invalid_content',
      mismatched.map((revision) => revision.fileId),
    );
  }

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
          : (objects.get(content.objectId)?.size ?? 0n),
      markdown: content.kind === 'markdown' ? content.text : null,
      objectId: content.kind === 'attachment' ? content.objectId : null,
    });
  }

  const existingContents = await db
    .select({ digest: contents.digest })
    .from(contents)
    .where(
      and(
        eq(contents.workspaceId, workspaceId),
        inArray(contents.digest, [...contentRows.keys()]),
      ),
    );
  const knownDigests = new Set(existingContents.map((row) => row.digest));
  const newContentRows = [...contentRows.values()].filter(
    (row) => !knownDigests.has(row.digest),
  );

  const newContentBytes = newContentRows.reduce(
    (total, row) => total + row.size,
    0n,
  );
  const chargedBytes =
    newContentBytes +
    BigInt(input.revisions.length) * revisionOverheadBytes +
    receiptOverheadBytes;

  const usageRows = await db
    .select({
      bytesUsed: workspaceUsage.bytesUsed,
      quotaBytes: workspaceUsage.quotaBytes,
    })
    .from(workspaceUsage)
    .where(eq(workspaceUsage.workspaceId, workspaceId));
  const usage = usageRows[0];
  if (usage === undefined) {
    throw new OperationalError(
      'unexpected',
      'notesapp: the workspace has no usage record.',
    );
  }
  if (newContentBytes > 0n) {
    if (
      usage.bytesUsed + chargedBytes >
      usage.quotaBytes - controlReserveBytes
    ) {
      return fail('quota');
    }
  } else if (usage.bytesUsed + chargedBytes > usage.quotaBytes) {
    return fail('quota');
  }

  if (newContentRows.length > 0) {
    await db.insert(contents).values(newContentRows).onConflictDoNothing();
  }

  const cursorResult = await client.query<{ next_cursor: string }>(
    'select public.notesapp_next_cursor($1) as next_cursor',
    [workspaceId],
  );
  const cursorValue = cursorResult.rows[0]?.next_cursor;
  if (cursorValue === undefined) {
    throw new OperationalError(
      'unexpected',
      'notesapp: failed to allocate cursor.',
    );
  }
  const cursor = BigInt(cursorValue);

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

  const revisionRows = input.revisions.map((revision) => ({
    workspaceId,
    id: revision.id,
    fileId: revision.fileId,
    contentDigest: revision.content.digest,
    path: revision.path,
    deleted: revision.deleted,
    changesetId,
    actorAccountId: actor.accountId,
    clientTime: new Date(revision.clientTime),
    message: revision.message,
    restoredFrom: revision.restoredFrom,
  }));
  await db.insert(revisions).values(revisionRows);

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

  const createdBranches: BranchRecord[] = [];
  for (const [fileId, tipRevision] of branchTips.entries()) {
    const branchId = randomUUID();
    const baseRevisionId = input.expectedHeads[fileId] ?? null;
    const now = new Date();
    await db.insert(branches).values({
      workspaceId,
      id: branchId,
      fileId,
      baseRevisionId,
      tipRevisionId: tipRevision.id,
      conflictGroupId: input.conflictGroupId,
      state: 'unresolved',
      createdAt: now,
    });
    createdBranches.push({
      id: branchId,
      workspaceId,
      fileId,
      baseRevisionId,
      tipRevisionId: tipRevision.id,
      conflictGroupId: input.conflictGroupId,
      state: 'unresolved',
      createdAt: now.toISOString(),
    });
  }

  await client.query('select public.notesapp_add_usage($1, $2)', [
    workspaceId,
    chargedBytes.toString(),
  ]);

  const outcome: AcceptedBranch = {
    mutationId: input.mutationId,
    conflictGroupId: input.conflictGroupId,
    revisionIds: input.revisions.map((r) => r.id),
    branches: createdBranches,
  };

  await db.insert(mutationReceipts).values({
    workspaceId,
    actorAccountId: actor.accountId,
    mutationId: input.mutationId,
    requestDigest: digest,
    outcome,
  });

  return ok(outcome);
}
