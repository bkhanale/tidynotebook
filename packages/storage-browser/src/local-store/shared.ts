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
import type { DraftRow, FileRow, LocalDatabase, Tables } from '../database.ts';
import { validateContent, validateDraft } from '../migrations.ts';

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
