/**
 * The shared context and the cross-area helpers of the local store.
 *
 * `openLocalStore` builds one `LocalStoreContext` and hands it to every area
 * module. The context carries the opened database, the tables, the origin the
 * store was opened for, the injected clock and identifier source, and the
 * invalidation `publish`. The helpers here read or shape rows that more than
 * one area needs, so no area repeats a partition query or a row mapping.
 */
import type { Draft, LocalChange } from '@notesapp/sync';
import {
  partitionRange,
  type DraftRow,
  type FileRow,
  type LocalDatabase,
  type Tables,
} from '../database.ts';
import {
  validateCheckpoint,
  validateContent,
  validateDraft,
  validateQueueRow,
  validateRecovery,
} from '../migrations.ts';

/**
 * The state every area module shares.
 *
 * The store is opened for one server origin and every key starts with that
 * origin. The clock and the identifier source are injected, so a test produces
 * the same records twice. `publish` fans one durable change out to the local
 * listeners and, when it exists, the broadcast channel.
 */
export type LocalStoreContext = {
  readonly serverOrigin: string;
  readonly deviceId: string;
  readonly db: LocalDatabase['db'];
  readonly tables: Tables;
  readonly clock: () => number;
  readonly newId: () => string;
  readonly nowIso: () => string;
  readonly publish: (change: LocalChange) => void;
};

/** The account-wide preference that records an offline sign-out. */
export const signOutMarkerName = 'signout-marker';

/** One state of a file that a draft can be compared with. */
export type HeadState = {
  readonly path: string;
  readonly deleted: boolean;
  readonly text: string | null;
};

/** The three parts that place a stored row in one partition. */
export type AccountRow = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
};

/** The number of UTF-8 bytes of a string. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Whether a working copy still describes the current state of its file.
 *
 * A draft is built on one revision: its last checkpoint, or the head it was
 * opened from. It leads whenever that anchor is still the accepted head, which
 * is the ordinary case of typing into a file that is in sync, and whenever
 * this device holds unsent work, whose local head is past the accepted one.
 *
 * It does not lead when the server moved the file past the anchor and nothing
 * local is pending. The accepted row is then the newer statement of the path
 * and of the deletion state, so a draft left over from an earlier deletion
 * cannot hide a note that the server brought back.
 */
export function draftLeads(
  file: FileRow | null | undefined,
  draft: DraftRow,
): boolean {
  if (file === null || file === undefined) return true;
  if (file.acceptedHeadRevisionId === null) return true;
  const anchor = draft.lastCheckpointId ?? draft.baseRevisionId;
  if (file.acceptedHeadRevisionId === anchor) return true;
  return file.localHeadRevisionId !== file.acceptedHeadRevisionId;
}

/**
 * The accepted revision that one submitted parent chain descends from.
 *
 * A submission states two things about its place in history: `parents` names
 * the revision its content was written over, and `expectedHeads` states the
 * accepted head the server must still hold. The two must name one lineage. The
 * mirror cannot answer the second question, because the ordered feed moves the
 * accepted head under an open working copy and the content stays where it was.
 * A submission that read the precondition from the mirror therefore passed the
 * one server check that keeps a save from replacing text this device never saw
 * (record 0073).
 *
 * The walk starts at the parent and climbs through the unaccepted checkpoints
 * of this device, because the server has none of them yet. It stops at the
 * first revision this device did not create, and at an accepted checkpoint of
 * its own, because both of those are revisions the server holds. A first
 * revision has no parent and answers `null`, which states that the server must
 * not have the file yet.
 *
 * The caller runs inside a transaction that covers the checkpoints table.
 */
export const expectedHeadOfParent = async (
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
  parentId: string | null,
): Promise<string | null> => {
  const seen = new Set<string>();
  let current = parentId;
  while (current !== null) {
    // An immutable checkpoint always names an earlier parent, so a repeat is a
    // corrupt graph rather than a long chain. Stopping at the repeat keeps the
    // walk finite and leaves the precondition on the last sound revision.
    if (seen.has(current)) return current;
    seen.add(current);
    const stored: unknown = await ctx.tables.checkpoints.get([
      ctx.serverOrigin,
      accountId,
      workspaceId,
      current,
    ]);
    if (stored === undefined) return current;
    const checkpoint = validateCheckpoint(stored);
    if (checkpoint.accepted) return current;
    current = checkpoint.parents[0] ?? null;
  }
  return null;
};

/** The stored form of a draft the caller supplied. */
export const draftRow = (
  ctx: LocalStoreContext,
  draft: Draft,
  lastCheckpointId: string | null,
): DraftRow => ({
  serverOrigin: ctx.serverOrigin,
  accountId: draft.accountId,
  workspaceId: draft.workspaceId,
  workingCopyId: draft.workingCopyId,
  fileId: draft.fileId,
  baseRevisionId: draft.baseRevisionId,
  text: draft.text,
  path: draft.path,
  deleted: draft.deleted,
  sequence: draft.sequence,
  lastCheckpointId,
  savedAt: ctx.nowIso(),
});

/** Every stored draft of one file, newest first. */
export const draftsOfFile = async (
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
  fileId: string,
): Promise<DraftRow[]> => {
  const rows: unknown[] = await ctx.tables.drafts
    .where('[serverOrigin+accountId+workspaceId+fileId]')
    .equals([ctx.serverOrigin, accountId, workspaceId, fileId])
    .toArray();
  return rows
    .map((row: unknown) => validateDraft(row))
    .sort((left, right) => {
      if (left.savedAt !== right.savedAt)
        return left.savedAt < right.savedAt ? 1 : -1;
      if (left.sequence !== right.sequence)
        return right.sequence - left.sequence;
      return left.workingCopyId < right.workingCopyId ? 1 : -1;
    });
};

/**
 * The next submission order number of one partition.
 *
 * The caller runs inside a transaction that covers the queue table, so two
 * writers of one partition cannot take the same number.
 */
export const nextQueueSequence = async (
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
): Promise<number> => {
  const range = partitionRange(ctx.serverOrigin, accountId, workspaceId);
  const last: unknown = await ctx.tables.queue
    .where('[serverOrigin+accountId+workspaceId+sequence]')
    .between(range.lower, range.upper, true, true)
    .last();
  return last === undefined ? 1 : validateQueueRow(last).sequence + 1;
};

/** The next checkpoint order number of one partition. */
export const nextCheckpointSequence = async (
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
): Promise<number> => {
  const range = partitionRange(ctx.serverOrigin, accountId, workspaceId);
  const last: unknown = await ctx.tables.checkpoints
    .where('[serverOrigin+accountId+workspaceId+sequence]')
    .between(range.lower, range.upper, true, true)
    .last();
  return last === undefined ? 1 : validateCheckpoint(last).sequence + 1;
};

/** The stored Markdown body of one digest, or `null` when it is absent. */
export const bodyOfDigest = async (
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
  digest: string,
): Promise<string | null> => {
  const stored: unknown = await ctx.tables.contents.get([
    ctx.serverOrigin,
    accountId,
    workspaceId,
    digest,
  ]);
  if (stored === undefined) return null;
  return validateContent(stored).text;
};

/**
 * Removes every local trace of one file.
 *
 * A permanently deleted file leaves no row on the server, so a client that
 * still holds any record of it would keep the note in the tree or revive it on
 * the next re-send, snapshot, or read. This deletes the accepted row, the
 * drafts, the checkpoints, the queued mutations, and the recovery copies of the
 * file. It never deletes a content body, because content is addressed by digest
 * and one body can back several files. The caller opens the transaction and
 * must cover the accepted files, the drafts, the checkpoints, the queue, and
 * the recovery tables.
 */
export const forgetFileRows = async (
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
  fileId: string,
): Promise<void> => {
  const { serverOrigin, tables } = ctx;
  await tables.acceptedFiles.delete([
    serverOrigin,
    accountId,
    workspaceId,
    fileId,
  ]);
  for (const draft of await draftsOfFile(ctx, accountId, workspaceId, fileId))
    await tables.drafts.delete([
      serverOrigin,
      accountId,
      workspaceId,
      draft.workingCopyId,
    ]);
  const checkpoints: unknown[] = await tables.checkpoints
    .where('[serverOrigin+accountId+workspaceId+fileId]')
    .equals([serverOrigin, accountId, workspaceId, fileId])
    .toArray();
  for (const row of checkpoints) {
    const checkpoint = validateCheckpoint(row);
    await tables.checkpoints.delete([
      serverOrigin,
      accountId,
      workspaceId,
      checkpoint.revisionId,
    ]);
  }
  const range = partitionRange(serverOrigin, accountId, workspaceId);
  const queued: unknown[] = await tables.queue
    .where('[serverOrigin+accountId+workspaceId+sequence]')
    .between(range.lower, range.upper, true, true)
    .toArray();
  for (const row of queued) {
    const entry = validateQueueRow(row);
    if (!entry.input.revisions.some((revision) => revision.fileId === fileId))
      continue;
    await tables.queue.delete([
      serverOrigin,
      accountId,
      workspaceId,
      entry.mutationId,
    ]);
  }
  const recovered: unknown[] = await tables.recovery
    .where('[serverOrigin+accountId+workspaceId+createdAt]')
    .between(range.lower, range.upper, true, true)
    .toArray();
  for (const row of recovered) {
    const record = validateRecovery(row);
    if (record.fileId !== fileId) continue;
    await tables.recovery.delete([
      serverOrigin,
      accountId,
      workspaceId,
      record.recoveryId,
    ]);
  }
};

/** Whether a stored row belongs to one account of this origin. */
export const matchesAccount = (
  ctx: LocalStoreContext,
  row: AccountRow,
  accountId: string,
): boolean =>
  row.serverOrigin === ctx.serverOrigin && row.accountId === accountId;

/** Whether a stored row belongs to one workspace partition. */
export const matchesPartition = (
  ctx: LocalStoreContext,
  row: AccountRow,
  accountId: string,
  workspaceId: string,
): boolean =>
  row.serverOrigin === ctx.serverOrigin &&
  row.accountId === accountId &&
  row.workspaceId === workspaceId;
