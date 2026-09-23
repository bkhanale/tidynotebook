/**
 * Snapshot staging and ordered change download.
 *
 * The design keeps the download in three separated steps:
 *
 * - Stage the plan: start a snapshot, page every captured item, and record
 *   the token with its immutable revision IDs and cursor. Nothing local
 *   changes yet.
 * - Fetch immutable revisions by ID, never by a later current head, and
 *   store each body in the staging area.
 * - Activate only when every staged revision and its required content is
 *   present. Activation advances accepted heads and the cursor but never
 *   touches drafts, checkpoints, the queue, or a dirty working copy.
 *
 * After the snapshot cursor is known, ordered changes are pulled and applied
 * in cursor order. An expired cursor, an expired token, or a revision that
 * vanished mid-download restarts from a fresh snapshot and keeps local work.
 */
import { bytesOfBase64 } from './bytes.ts';
import {
  LocalStorageError,
  type LocalFileKind,
  type LocalStore,
  type RemoteChange,
  type RemoteFileChange,
} from './local-port.ts';
import {
  SnapshotRestartNeeded,
  SyncFailedError,
  sendWithRetry,
  type ServiceOutcome,
  type SyncContext,
} from './queue.ts';

/** One pinned file of a snapshot page, in domain shape. */
export type SnapshotItemData = {
  readonly fileId: string;
  readonly revisionId: string;
  readonly path: string;
  readonly fileKind: LocalFileKind;
  readonly deleted: boolean;
};

/** One immutable revision body, in domain shape. */
export type RevisionData = {
  readonly fileId: string;
  readonly revisionId: string;
  readonly path: string;
  readonly fileKind: LocalFileKind;
  readonly deleted: boolean;
  readonly digest: string;
  readonly text: string | null;
  /** The whole document of the note, as base64, or `null` (record 0081). */
  readonly document: string | null;
  /** The generation of that document, or `null`. */
  readonly epoch: number | null;
};

/**
 * One ordered change record.
 *
 * `file` names the revision that a write accepted. `purgedFileId` names a file
 * that a permanent deletion removed; such a record has no revision to read,
 * because the revisions are gone. A record with neither is a membership
 * record, which only advances the cursor.
 */
export type ChangeRecord = {
  /**
   * The accepted change of one file, with the work that a note carries. The
   * feed states everything a reader needs, so no reader fetches a revision to
   * learn what changed (record 0081).
   */
  readonly file: RemoteFileChange | null;
  /** The file that a permanent deletion removed, or `null`. */
  readonly purgedFileId: string | null;
};

/** What download needs from the network. */
export type SnapshotNetwork = {
  start(signal: AbortSignal): Promise<
    ServiceOutcome<{
      readonly token: string;
      readonly cursor: string;
      readonly itemCount: number;
    }>
  >;
  page(
    token: string,
    position: number,
    signal: AbortSignal,
  ): Promise<
    ServiceOutcome<{
      readonly token: string;
      readonly cursor: string;
      readonly items: readonly SnapshotItemData[];
      readonly nextPosition: number | null;
    }>
  >;
  revision(
    revisionId: string,
    signal: AbortSignal,
  ): Promise<ServiceOutcome<RevisionData>>;
  changes(
    cursor: string,
    signal: AbortSignal,
  ): Promise<
    ServiceOutcome<{
      readonly changes: readonly ChangeRecord[];
      readonly nextCursor: string;
    }>
  >;
};

/** How one pull run ended. `deferred` means transport failed; retry later. */
export type PullOutcome = 'done' | 'deferred' | 'paused' | 'access-lost';

/** A fresh snapshot and the cursor it captured. */
type FreshSnapshot =
  | { readonly status: 'ready'; readonly cursor: string }
  | { readonly status: 'deferred' | 'paused' | 'access-lost' };

/**
 * Brings one workspace down to the current server state.
 *
 * Starts with a full snapshot when this device never synced, otherwise pulls
 * the ordered changes after the stored cursor. Returns `paused` when the
 * session expired and `access-lost` when reads are denied.
 */
export async function pullNew(
  local: LocalStore,
  accountId: string,
  workspaceId: string,
  net: SnapshotNetwork,
  ctx: SyncContext,
): Promise<PullOutcome> {
  let cursor = await local.readCursor(accountId, workspaceId);
  for (let round = 0; round < 2; round += 1) {
    try {
      if (cursor === null) {
        const fresh = await fullSnapshot(
          local,
          accountId,
          workspaceId,
          net,
          ctx,
        );
        if (fresh.status !== 'ready') return fresh.status;
        cursor = fresh.cursor;
      }
      return await fetchAndApply(
        local,
        accountId,
        workspaceId,
        net,
        ctx,
        cursor,
      );
    } catch (error: unknown) {
      if (error instanceof SnapshotRestartNeeded && round === 0) {
        ctx.announce({ kind: 'snapshot-restart', reason: error.reason });
        cursor = null;
        continue;
      }
      throw error;
    }
  }
  throw new SyncFailedError('snapshot_failed', 0);
}

/**
 * Downloads a complete snapshot and activates it.
 *
 * Every page is read before anything is staged, so a failure leaves no
 * partial plan behind. Every revision body is stored before activation, so
 * activation either finds a complete snapshot or refuses it.
 */
async function fullSnapshot(
  local: LocalStore,
  accountId: string,
  workspaceId: string,
  net: SnapshotNetwork,
  ctx: SyncContext,
): Promise<FreshSnapshot> {
  const started = await sendWithRetry(ctx, (signal) => net.start(signal));
  if (started === null) return { status: 'deferred' };
  if (!started.ok) {
    if (started.problem.status === 401) return { status: 'paused' };
    if (started.problem.status === 403 || started.problem.status === 404)
      return { status: 'access-lost' };
    throw new SyncFailedError(started.problem.code, started.problem.status);
  }
  const token = started.value.token;
  const revisionIds: string[] = [];
  let position = 0;
  for (;;) {
    const page = await sendWithRetry(ctx, (signal) =>
      net.page(token, position, signal),
    );
    if (page === null) return { status: 'deferred' };
    if (!page.ok) {
      if (page.problem.status === 401) return { status: 'paused' };
      if (page.problem.status === 403 || page.problem.status === 404)
        return { status: 'access-lost' };
      if (page.problem.status === 410)
        throw new SnapshotRestartNeeded('page-expired');
      throw new SyncFailedError(page.problem.code, page.problem.status);
    }
    for (const item of page.value.items) revisionIds.push(item.revisionId);
    if (page.value.nextPosition === null) break;
    position = page.value.nextPosition;
  }
  await local.stageSnapshot(
    accountId,
    workspaceId,
    token,
    revisionIds,
    started.value.cursor,
  );
  for (const revisionId of revisionIds) {
    const fetched = await sendWithRetry(ctx, (signal) =>
      net.revision(revisionId, signal),
    );
    if (fetched === null) return { status: 'deferred' };
    if (!fetched.ok) {
      if (fetched.problem.status === 401) return { status: 'paused' };
      if (fetched.problem.status === 403) return { status: 'access-lost' };
      if (fetched.problem.status === 404 || fetched.problem.status === 410)
        throw new SnapshotRestartNeeded('revision-purged');
      throw new SyncFailedError(fetched.problem.code, fetched.problem.status);
    }
    const revision = fetched.value;
    await local.storeSnapshotRevision(accountId, workspaceId, {
      token,
      revisionId: revision.revisionId,
      fileId: revision.fileId,
      path: revision.path,
      kind: revision.fileKind,
      deleted: revision.deleted,
      digest: revision.digest,
      text: revision.text,
      document:
        revision.document === null ? null : bytesOfBase64(revision.document),
      epoch: revision.epoch,
    });
  }
  try {
    await local.activateSnapshot(token);
  } catch (error: unknown) {
    if (error instanceof LocalStorageError && error.kind === 'aborted')
      throw new SnapshotRestartNeeded('incomplete');
    throw error;
  }
  ctx.announce({ kind: 'snapshot-activated', count: revisionIds.length });
  return { status: 'ready', cursor: started.value.cursor };
}

/**
 * Pulls one page of ordered changes and applies it.
 *
 * File changes resolve their immutable revision before anything is stored;
 * a revision that vanished since the change was recorded restarts from a
 * fresh snapshot. Records without a file only move the cursor.
 */
async function fetchAndApply(
  local: LocalStore,
  accountId: string,
  workspaceId: string,
  net: SnapshotNetwork,
  ctx: SyncContext,
  cursor: string,
): Promise<PullOutcome> {
  const fed = await sendWithRetry(ctx, (signal) => net.changes(cursor, signal));
  if (fed === null) return 'deferred';
  if (!fed.ok) {
    if (fed.problem.status === 401) return 'paused';
    if (fed.problem.status === 403 || fed.problem.status === 404)
      return 'access-lost';
    if (fed.problem.status === 410)
      throw new SnapshotRestartNeeded('cursor-expired');
    throw new SyncFailedError(fed.problem.code, fed.problem.status);
  }
  const files: RemoteChange[] = [];
  // One page can contain a note deletion and its later permanent deletion.
  // The purge removes the deletion revision before this device can fetch it.
  // Skip every earlier revision for that file and apply the final purge.
  const purgedFileIds = new Set(
    fed.value.changes.flatMap((change) =>
      change.purgedFileId === null ? [] : [change.purgedFileId],
    ),
  );
  for (const change of fed.value.changes) {
    const pointer = change.file;
    if (pointer === null) {
      // A purge carries no revision to read: the revisions are gone. The
      // record therefore travels on its own, so the local cache learns to
      // forget the file instead of only moving the cursor past it.
      files.push({ file: null, purgedFileId: change.purgedFileId });
      continue;
    }
    if (purgedFileIds.has(pointer.fileId)) continue;
    files.push({ file: pointer, purgedFileId: null });
  }
  try {
    await local.applyRemoteChanges(
      accountId,
      workspaceId,
      files,
      fed.value.nextCursor,
    );
  } catch (error: unknown) {
    // Accepted work that does not fit the document this device holds cannot
    // be repaired from the feed, which states only the work. The transaction
    // wrote nothing, and a snapshot carries the whole document of every note.
    if (error instanceof LocalStorageError && error.kind === 'stale')
      throw new SnapshotRestartNeeded('document-gap');
    throw error;
  }
  const fileCount = files.filter(
    (change) => change.file !== null || change.purgedFileId !== null,
  ).length;
  if (fileCount > 0)
    ctx.announce({ kind: 'changes-applied', count: fileCount });
  return 'done';
}
