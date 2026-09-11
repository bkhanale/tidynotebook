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
 * The answer carries the rows, the current high-water cursor, and the oldest
 * retained cursor, so the caller can tell an empty poll from a cursor that
 * predates the retained window.
 */
export async function readSyncChanges(
  client: pg.PoolClient,
  input: {
    readonly workspaceId: string;
    readonly afterCursor: string;
    readonly limit: number;
  },
): Promise<SyncChangeFeed> {
  const rows = await client.query<{
    cursor: string;
    entity_kind: string;
    entity_id: string;
    revision_id: string | null;
    deleted: boolean;
  }>(
    `select cursor, entity_kind, entity_id, revision_id, deleted from sync_changes
      where workspace_id = $1 and cursor > $2::bigint
      order by cursor asc, entity_kind asc, entity_id asc
      limit $3`,
    [input.workspaceId, input.afterCursor, input.limit],
  );
  const cursor = await highWater(client, input.workspaceId);
  const oldest = await client.query<{ oldest: string | null }>(
    'select min(cursor) as oldest from sync_changes where workspace_id = $1',
    [input.workspaceId],
  );
  const changes: SyncChange[] = rows.rows.map((row) => ({
    cursor: BigInt(row.cursor).toString(),
    entityKind: row.entity_kind === 'membership' ? 'membership' : 'file',
    entityId: row.entity_id,
    revisionId: row.revision_id,
    deleted: row.deleted,
  }));
  return {
    changes,
    highWater: cursor.toString(),
    oldestRetained:
      oldest.rows[0]?.oldest === null || oldest.rows[0]?.oldest === undefined
        ? null
        : BigInt(oldest.rows[0].oldest as string).toString(),
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
