/**
 * Snapshot capture, snapshot paging, incremental sync reads, and retention.
 *
 * The functions here run inside the workspace transaction that
 * `workspace-store/transaction.ts` opens, under the workspace advisory lock.
 * The capture runs under repeatable read (set by `runTransaction`), so the
 * captured file
 * metadata and its high-water cursor come from one stable view. Page reads run
 * in their own short transactions: no transaction stays open across network
 * pages.
 *
 * A snapshot token is a random opaque string. Only its SHA-256 hash is stored,
 * so a stolen database row cannot be replayed as a token.
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import {
  maxOpenSnapshots,
  syncRetentionDays,
  type SnapshotItem,
  type SnapshotPage,
  type SnapshotStart,
  type SyncChange,
  type SyncChangeFeed,
} from '@notesapp/core';

/** Rows written per snapshot item statement, so a large workspace stays bounded. */
const itemInsertChunk = 250;

/** A snapshot token is 32 random bytes in unpadded base64url. */
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** Creates one opaque snapshot token. */
export function newSnapshotToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The SHA-256 hash of a snapshot token, in lower case hexadecimal. */
export function snapshotTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Whether a value has the shape of a snapshot token. */
export function isSnapshotToken(value: string): boolean {
  return tokenPattern.test(value);
}

/** The high-water cursor of one workspace. */
async function highWater(
  client: pg.PoolClient,
  workspaceId: string,
): Promise<bigint> {
  const result = await client.query<{ last_cursor: string }>(
    'select last_cursor from workspace_cursors where workspace_id = $1',
    [workspaceId],
  );
  const value = result.rows[0]?.last_cursor;
  if (value === undefined) {
    throw new Error('notesapp: the workspace has no cursor record.');
  }
  return BigInt(value);
}

/**
 * Captures accepted metadata and the high-water cursor.
 *
 * The caller holds the workspace lock in a repeatable-read transaction. Every
 * live file with an accepted head becomes one materialized item with its
 * immutable head revision, ordered by file identifier. Past the admission
 * limit the oldest open snapshot of the workspace is evicted first.
 */
export async function captureSnapshot(
  client: pg.PoolClient,
  input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly pageSize: number;
    readonly now: Date;
    readonly ttlMs: number;
  },
): Promise<SnapshotStart> {
  const cursor = await highWater(client, input.workspaceId);
  const live = await client.query<{
    id: string;
    head_revision_id: string;
    path: string;
    kind: string;
    deleted: boolean;
  }>(
    `select id, head_revision_id, path, kind, deleted from files
      where workspace_id = $1 and deleted = false and head_revision_id is not null
      order by id`,
    [input.workspaceId],
  );
  const open = await client.query<{ token_hash: string }>(
    `select token_hash from snapshots
      where workspace_id = $1 and expires_at > $2
      order by created_at asc`,
    [input.workspaceId, input.now],
  );
  const excess = open.rows.length - maxOpenSnapshots + 1;
  if (excess > 0) {
    const evicted = open.rows.slice(0, excess).map((row) => row.token_hash);
    await client.query('delete from snapshots where token_hash = any($1)', [
      evicted,
    ]);
  }
  const token = newSnapshotToken();
  const expiresAt = new Date(input.now.getTime() + input.ttlMs);
  await client.query(
    `insert into snapshots
        (token_hash, workspace_id, account_id, cursor, item_count, page_size, expires_at)
      values ($1, $2, $3, $4::bigint, $5, $6, $7::timestamptz)`,
    [
      snapshotTokenHash(token),
      input.workspaceId,
      input.accountId,
      cursor.toString(),
      live.rows.length,
      input.pageSize,
      expiresAt,
    ],
  );
  const hash = snapshotTokenHash(token);
  for (let at = 0; at < live.rows.length; at += itemInsertChunk) {
    const chunk = live.rows.slice(at, at + itemInsertChunk);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((row, index) => {
      const base = params.length;
      values.push(
        `($${String(base + 1)}, $${String(base + 2)}, $${String(base + 3)}, $${String(base + 4)}, $${String(base + 5)})`,
      );
      params.push(
        hash,
        at + index,
        input.workspaceId,
        row.id,
        row.head_revision_id,
      );
    });
    await client.query(
      `insert into snapshot_items
          (token_hash, ordinal, workspace_id, file_id, revision_id)
        values ${values.join(', ')}`,
      params,
    );
  }
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    cursor: cursor.toString(),
    itemCount: live.rows.length,
    pageSize: input.pageSize,
  };
}

/**
 * Reads one page of a materialized snapshot.
 *
 * Returns `null` when the token is unknown, the snapshot expired, or a purge
 * removed one of its pinned revisions. All three need a fresh snapshot, so the
 * caller reports them the same way.
 */
export async function readSnapshotPage(
  client: pg.PoolClient,
  input: {
    readonly workspaceId: string;
    readonly token: string;
    readonly position: number;
    readonly limit: number;
    readonly now: Date;
  },
): Promise<SnapshotPage | null> {
  if (!isSnapshotToken(input.token)) return null;
  const stored = await client.query<{
    cursor: string;
    item_count: number;
    page_size: number;
    expires_at: Date;
  }>(
    `select cursor, item_count, page_size, expires_at from snapshots
      where token_hash = $1 and workspace_id = $2`,
    [snapshotTokenHash(input.token), input.workspaceId],
  );
  const snapshot = stored.rows[0];
  if (snapshot === undefined) return null;
  if (snapshot.expires_at.getTime() <= input.now.getTime()) return null;
  const counted = await client.query<{ total: string }>(
    'select count(*) as total from snapshot_items where token_hash = $1',
    [snapshotTokenHash(input.token)],
  );
  const total = Number(counted.rows[0]?.total ?? '0');
  // A purge deletes the items of its files before it removes their revisions,
  // so a smaller item set means a pinned revision is gone and the snapshot
  // cannot be completed. The client restarts instead of reading a partial
  // state.
  if (total < snapshot.item_count) return null;
  const rows = await client.query<{
    file_id: string;
    revision_id: string;
    path: string;
    kind: string;
    deleted: boolean;
  }>(
    `select si.file_id, si.revision_id, f.path, f.kind, f.deleted
      from snapshot_items si
      join files f on f.workspace_id = si.workspace_id and f.id = si.file_id
      where si.token_hash = $1 and si.ordinal >= $2
      order by si.ordinal
      limit $3`,
    [snapshotTokenHash(input.token), input.position, input.limit],
  );
  const items: SnapshotItem[] = rows.rows.map((row) => ({
    fileId: row.file_id,
    revisionId: row.revision_id,
    path: row.path,
    kind: row.kind === 'attachment' ? 'attachment' : 'note',
    deleted: row.deleted,
  }));
  const next =
    input.position + items.length < total
      ? input.position + items.length
      : null;
  return {
    token: input.token,
    cursor: BigInt(snapshot.cursor).toString(),
    expiresAt: snapshot.expires_at.toISOString(),
    position: input.position,
    nextPosition: next,
    totalItems: total,
    items,
  };
}

/**
 * Reads the ordered change records after one cursor.
 *
 * The rows hold whole commits only, because every row of one commit shares
 * its cursor and the reader continues after the last cursor it read. The page
 * stops before a commit that would pass the limit, and holds the first commit
 * whole when it alone passes the limit (record 0127). The answer carries the
 * rows, the current high-water cursor, and the oldest retained cursor, so the
 * caller can tell an empty poll from a cursor that predates the retained
 * window.
 */
export async function readSyncChanges(
  client: pg.PoolClient,
  input: {
    readonly workspaceId: string;
    readonly afterCursor: string;
    readonly limit: number;
  },
): Promise<SyncChangeFeed> {
  // The last cursor of the page. Each commit counts its rows, and the running
  // total of whole commits stays inside the limit. The first commit always
  // enters, so a commit larger than the limit still makes progress. One
  // transaction writes every row of a commit, so the second statement cannot
  // see a part of a commit that the first one counted.
  const bound = await client.query<{ last: string | null }>(
    `select max(g.cursor)::text as last
      from (
        select cursor,
               row_number() over (order by cursor) as place,
               sum(count(*)) over (order by cursor) as through
          from sync_changes
          where workspace_id = $1 and cursor > $2::bigint
          group by cursor
          order by cursor
          limit $3
      ) g
      where g.place = 1 or g.through <= $3`,
    [input.workspaceId, input.afterCursor, input.limit],
  );
  const lastCursor = bound.rows[0]?.last ?? null;
  // The feed states everything a reader needs, so the record carries the
  // accepted work of the revision beside its metadata (record 0081). A note
  // whose revision holds no delta is a generation boundary, and the whole
  // document of that note answers it instead.
  const rows = await client.query<{
    cursor: string;
    entity_kind: string;
    entity_id: string;
    revision_id: string | null;
    deleted: boolean;
    path: string | null;
    file_kind: string | null;
    content_digest: string | null;
    document_update: Buffer | null;
    document_vector: Buffer | null;
    document_epoch: number | null;
    document_bytes: Buffer | null;
    document_current_epoch: number | null;
  }>(
    `select c.cursor,
            c.entity_kind,
            c.entity_id,
            c.revision_id,
            c.deleted,
            r.path,
            f.kind as file_kind,
            r.content_digest,
            r.document_update,
            r.document_vector,
            r.document_epoch,
            d.bytes as document_bytes,
            d.epoch as document_current_epoch
      from sync_changes c
      left join revisions r
        on r.workspace_id = c.workspace_id and r.id = c.revision_id
      left join files f
        on f.workspace_id = c.workspace_id and f.id = c.entity_id
      left join note_documents d
        on d.workspace_id = c.workspace_id and d.file_id = c.entity_id
      where c.workspace_id = $1
        and c.cursor > $2::bigint
        and c.cursor <= $3::bigint
      order by c.cursor asc, c.entity_kind asc, c.entity_id asc`,
    [input.workspaceId, input.afterCursor, lastCursor ?? input.afterCursor],
  );
  const cursor = await highWater(client, input.workspaceId);
  const oldest = await client.query<{ oldest: string | null }>(
    'select min(cursor) as oldest from sync_changes where workspace_id = $1',
    [input.workspaceId],
  );
  const oldestCursor = oldest.rows[0]?.oldest ?? null;
  const changes: SyncChange[] = rows.rows.map((row) => {
    const at = BigInt(row.cursor).toString();
    if (row.entity_kind === 'membership')
      return {
        kind: 'membership' as const,
        cursor: at,
        accountId: row.entity_id,
        removed: row.deleted,
      };
    // A permanent deletion names no revision, because the revisions are gone.
    if (row.revision_id === null || row.path === null)
      return { kind: 'purge' as const, cursor: at, fileId: row.entity_id };
    const note = row.file_kind !== 'attachment';
    if (
      note &&
      row.document_update === null &&
      row.document_bytes !== null &&
      row.document_current_epoch !== null
    )
      return {
        kind: 'document' as const,
        cursor: at,
        fileId: row.entity_id,
        revisionId: row.revision_id,
        path: row.path,
        deleted: row.deleted,
        digest: row.content_digest ?? '',
        epoch: row.document_current_epoch,
        document: new Uint8Array(row.document_bytes),
      };
    return {
      kind: 'update' as const,
      cursor: at,
      fileId: row.entity_id,
      revisionId: row.revision_id,
      path: row.path,
      deleted: row.deleted,
      digest: row.content_digest ?? '',
      kindOfFile: note ? ('note' as const) : ('attachment' as const),
      epoch: row.document_epoch,
      update:
        row.document_update === null
          ? null
          : new Uint8Array(row.document_update),
      stateVector:
        row.document_vector === null
          ? null
          : new Uint8Array(row.document_vector),
    };
  });
  return {
    changes,
    highWater: cursor.toString(),
    oldestRetained:
      oldestCursor === null ? null : BigInt(oldestCursor).toString(),
  };
}

/**
 * Allocates one cursor and appends sync records under the workspace lock.
 *
 * Returns the allocated cursor as a decimal string. Every relevant write uses
 * this path, including membership, deletion, and purge, so the commit ordered
 * stream cannot skip a transaction that commits late.
 */
export async function emitSyncRows(
  client: pg.PoolClient,
  input: {
    readonly workspaceId: string;
    readonly entries: readonly {
      readonly entityKind: 'file' | 'membership';
      readonly entityId: string;
      readonly revisionId: string | null;
      readonly deleted: boolean;
    }[];
  },
): Promise<string> {
  if (input.entries.length === 0) {
    const cursor = await highWater(client, input.workspaceId);
    return cursor.toString();
  }
  const allocated = await client.query<{ cursor: string }>(
    'select notesapp_next_cursor($1) as cursor',
    [input.workspaceId],
  );
  const cursor = allocated.rows[0]?.cursor;
  if (cursor === undefined) {
    throw new Error('notesapp: the workspace cursor was not allocated.');
  }
  const values: string[] = [];
  const params: unknown[] = [input.workspaceId, cursor];
  for (const entry of input.entries) {
    const base = params.length;
    values.push(
      `($1, $2::bigint, $${String(base + 1)}, $${String(base + 2)}, $${String(base + 3)}, $${String(base + 4)})`,
    );
    params.push(
      entry.entityKind,
      entry.entityId,
      entry.revisionId,
      entry.deleted,
    );
  }
  await client.query(
    `insert into sync_changes
        (workspace_id, cursor, entity_kind, entity_id, revision_id, deleted)
      values ${values.join(', ')}`,
    params,
  );
  return BigInt(cursor).toString();
}

/**
 * Removes expired snapshots and change records older than the retention.
 *
 * Revisions, contents, receipts, and purge markers are left alone, so saved
 * history stays valid beyond the event window.
 */
export async function runSyncCleanup(
  client: pg.PoolClient,
  now: Date,
): Promise<{ expiredSnapshots: number; oldChanges: number }> {
  const changesCutoff = new Date(
    now.getTime() - syncRetentionDays * 24 * 60 * 60 * 1000,
  );
  const result = await client.query<{
    expired_snapshots: string;
    old_changes: string;
  }>('select * from notesapp_cleanup_sync($1, $2)', [now, changesCutoff]);
  const row = result.rows[0];
  return {
    expiredSnapshots: Number(row?.expired_snapshots ?? '0'),
    oldChanges: Number(row?.old_changes ?? '0'),
  };
}
