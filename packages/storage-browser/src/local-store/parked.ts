/**
 * The parked saves of the queue (record 0183).
 *
 * A parked save is a queue entry that the server refused for good. The server
 * holds no revision of it, so no later save may name it as a parent, and a
 * later save that carries all of its work makes its row in Needs attention
 * stale. The rule of which save supersedes which lives in
 * `@notesapp/sync` (`supersededSaves`). This module applies it inside the
 * transaction of the caller: `markConflict` and `acknowledge` of `queue.ts`.
 */
import type { RevisionInput } from '@notesapp/core';
import type { LocalChange } from '@notesapp/sync';
import { supersededSaves } from '@notesapp/sync';
import { observedCovers } from '@notesapp/note-document';
import { partitionRange, type QueueRow } from '../database.ts';
import {
  validateCheckpoint,
  validateQueueRow,
  validateRecovery,
} from '../migrations.ts';
import { forgetReviews } from './reviews.ts';
import {
  expectedHeadOfParent,
  forgetMutationWork,
  parentOfNextSave,
  type LocalStoreContext,
} from './shared.ts';

/** Every queue row of one partition, in submission order. */
async function queueRowsOf(
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
): Promise<QueueRow[]> {
  const range = partitionRange(ctx.serverOrigin, accountId, workspaceId);
  const rows: unknown[] = await ctx.tables.queue
    .where('[serverOrigin+accountId+workspaceId+sequence]')
    .between(range.lower, range.upper, true, true)
    .toArray();
  return rows.map((row: unknown) => validateQueueRow(row));
}

/**
 * Moves each unsent save off the revisions of one parked save.
 *
 * A save that waits with no frozen digest and names a parked revision as a
 * parent takes the nearest revision of its chain that is not parked, and its
 * precondition follows from that parent (record 0073). Its checkpoint names
 * the same parent, so the local record states the request. A save whose
 * digest is frozen keeps its body. The caller has already marked the save
 * parked, and runs inside a transaction that covers the queue and the
 * checkpoints.
 */
export async function moveChildrenOffParked(
  ctx: LocalStoreContext,
  parked: QueueRow,
): Promise<LocalChange[]> {
  const { serverOrigin, tables } = ctx;
  const { accountId, workspaceId } = parked;
  const parkedRevisions = new Set(
    parked.input.revisions.map((revision) => revision.id),
  );
  const changes: LocalChange[] = [];
  for (const row of await queueRowsOf(ctx, accountId, workspaceId)) {
    if (row.mutationId === parked.mutationId) continue;
    if (row.state !== 'pending' || row.digest !== null) continue;
    if (
      !row.input.revisions.some((revision) =>
        revision.parents.some((parent) => parkedRevisions.has(parent)),
      )
    )
      continue;
    const expectedHeads = { ...row.input.expectedHeads };
    const revisions: RevisionInput[] = [];
    for (const revision of row.input.revisions) {
      const parent = revision.parents[0] ?? null;
      if (parent === null || !parkedRevisions.has(parent)) {
        revisions.push(revision);
        continue;
      }
      const moved = await parentOfNextSave(ctx, accountId, workspaceId, parent);
      const parents = moved === null ? [] : [moved];
      revisions.push({ ...revision, parents });
      expectedHeads[revision.fileId] = await expectedHeadOfParent(
        ctx,
        accountId,
        workspaceId,
        moved,
      );
      const stored: unknown = await tables.checkpoints.get([
        serverOrigin,
        accountId,
        workspaceId,
        revision.id,
      ]);
      if (stored !== undefined)
        await tables.checkpoints.put({
          ...validateCheckpoint(stored),
          parents,
        });
    }
    await tables.queue.put({
      ...row,
      input: { ...row.input, expectedHeads, revisions },
    });
    changes.push({
      accountId,
      workspaceId,
      fileId: row.input.revisions[0]?.fileId ?? null,
      kind: 'queue',
    });
  }
  return changes;
}

/**
 * Removes each parked save that one later save supersedes.
 *
 * The parked entry, its checkpoints and its kept text leave together, and
 * each working copy that named one of its checkpoints moves to the nearest
 * one that stays. The later save holds every insertion and deletion of it,
 * so no word leaves with it. The caller runs inside a transaction that covers
 * the queue, the checkpoints, the accepted files, the drafts, the recovery
 * area and the Reviews.
 */
export async function dropSupersededSaves(
  ctx: LocalStoreContext,
  later: QueueRow,
): Promise<LocalChange[]> {
  const { serverOrigin, tables } = ctx;
  const { accountId, workspaceId } = later;
  const rows = await queueRowsOf(ctx, accountId, workspaceId);
  const superseded = new Set(
    supersededSaves(
      later.input,
      rows.map((row) => ({
        accountId: row.accountId,
        input: row.input,
        state: row.state,
        digest: row.digest,
        errorCode: row.errorCode,
      })),
      observedCovers,
    ),
  );
  if (superseded.size === 0) return [];
  const changes: LocalChange[] = [];
  for (const row of rows) {
    if (!superseded.has(row.mutationId)) continue;
    await tables.queue.delete([
      serverOrigin,
      accountId,
      workspaceId,
      row.mutationId,
    ]);
    changes.push(
      ...(await forgetMutationWork(
        ctx,
        accountId,
        workspaceId,
        row.mutationId,
        row.input.revisions,
        'follow',
      )),
    );
    changes.push({
      accountId,
      workspaceId,
      fileId: row.input.revisions[0]?.fileId ?? null,
      kind: 'queue',
    });
  }
  const range = partitionRange(serverOrigin, accountId, workspaceId);
  const kept: unknown[] = await tables.recovery
    .where('[serverOrigin+accountId+workspaceId+recoveryId]')
    .between(range.lower, range.upper, true, true)
    .toArray();
  for (const value of kept) {
    const record = validateRecovery(value);
    if (record.mutationId === null || !superseded.has(record.mutationId))
      continue;
    await tables.recovery.delete([
      serverOrigin,
      accountId,
      workspaceId,
      record.recoveryId,
    ]);
    await forgetReviews(
      ctx,
      accountId,
      workspaceId,
      record.fileId,
      record.recoveryId,
    );
    changes.push(
      { accountId, workspaceId, fileId: record.fileId, kind: 'conflict' },
      { accountId, workspaceId, fileId: record.fileId, kind: 'review' },
    );
  }
  return changes;
}
