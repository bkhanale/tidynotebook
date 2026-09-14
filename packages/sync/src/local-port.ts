/**
 * The local persistence port.
 *
 * The sync package owns these interfaces; `@notesapp/storage-browser`
 * implements them with IndexedDB, and the web application connects the two.
 * Nothing here imports a browser database, so the rules and the record shapes
 * stay testable without one.
 *
 * Every private record belongs to one partition: the server origin, the
 * account, and the workspace. The design requires that partition, because one
 * browser profile can hold several accounts of several installations and one
 * account must never read the records of another. A `LocalStore` is opened for
 * one server origin, so `Draft` and `QueueEntry` name only the account and the
 * workspace; the store adds its own origin to every row it writes.
 *
 * Local browser data is not a backup. It is the working copy of one device.
 */
import type { AcceptedChangeset, ChangesetInput } from '@notesapp/core';
import type { LocalSearchFile } from './local-search.ts';

/**
 * The partition of one set of private local records.
 *
 * `serverOrigin` is the origin of the installation, for example
 * `https://notes.example.com`. It is part of every key, so two installations
 * in one browser profile cannot mix their records.
 */
export type Partition = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
};

/**
 * The reserved workspace identifier of a value that belongs to the account
 * rather than to one workspace, for example the theme choice.
 *
 * An IndexedDB key cannot be `null`, so the partition keeps three parts and
 * this value fills the workspace part. It is not a valid UUID, so it cannot
 * collide with a real workspace.
 */
export const accountWide = '';

/**
 * The working text of one open editor.
 *
 * Each open editor of one file gets its own `workingCopyId`, so two tabs on
 * one file never write to one draft record. `baseRevisionId` is the accepted
 * revision the editor started from, or `null` for a file that the server has
 * not accepted yet. `sequence` increases with every save of that working copy,
 * so a late write cannot overwrite a newer one.
 *
 * A draft is mutable and coalesced. A checkpoint is not.
 */
export type Draft = {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly workingCopyId: string;
  readonly fileId: string;
  readonly baseRevisionId: string | null;
  readonly text: string;
  readonly path: string;
  readonly deleted: boolean;
  readonly sequence: number;
};

/**
 * Where one queued mutation stands.
 *
 * `conflict` means that the server refused the mutation for good and that the
 * body is kept for the person to place again.
 */
export type QueueState = 'pending' | 'sending' | 'conflict';

/**
 * One mutation that waits for the server.
 *
 * `input` is fixed once the entry exists. The design requires that a sent
 * mutation cannot change its identity or its body, so a retry after a lost
 * answer repeats the same operation instead of writing a second one.
 * `digest` is the request digest, frozen when the entry is first sent.
 */
export type QueueEntry = {
  readonly accountId: string;
  readonly input: ChangesetInput;
  readonly state: QueueState;
  readonly digest: string | null;
  readonly errorCode: string | null;
};

/**
 * Content-free notice that durable local state changed.
 *
 * `conflict` names a change of the Needs attention list: a save the server
 * refused for good, or a recovery copy that was kept or removed.
 */
export type LocalChange = {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly fileId: string | null;
  readonly kind:
    'draft' | 'queue' | 'file' | 'purge' | 'conflict' | 'cursor' | 'reset';
};

/** One file as it must appear in local navigation. */
export type LocalFileSummary = {
  readonly fileId: string;
  readonly path: string;
  readonly kind: LocalFileKind;
  readonly deleted: boolean;
  readonly updatedAt: string;
  readonly acceptedHeadRevisionId: string | null;
  readonly localHeadRevisionId: string | null;
  readonly localOnly: boolean;
};

/** Durable save facts for one file only. */
export type FileSaveSnapshot = {
  readonly fileId: string;
  readonly latestDraftSequence: number | null;
  readonly latestMutationId: string | null;
  readonly queueState: QueueState | null;
  readonly acceptedHeadRevisionId: string | null;
  readonly localHeadRevisionId: string | null;
  readonly hasUncheckpointedDraft: boolean;
};

/**
 * One queued mutation that the server refused for good.
 *
 * The Needs attention list reads these. The body is kept, so the person can
 * place the text again or discard it.
 */
export type LocalConflict = {
  readonly accountId: string;
  readonly fileId: string;
  readonly mutationId: string;
  readonly input: ChangesetInput;
  readonly errorCode: string | null;
};

/**
 * One locally created revision.
 *
 * Every field except `accepted` is immutable. A checkpoint names one state of
 * one file for as long as it is stored, and acknowledgment only records that
 * the server took it. Nothing rewrites `parents`, so the local graph stays
 * stable while work is pending.
 */
export type CheckpointRecord = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly revisionId: string;
  readonly fileId: string;
  /** The editor that created it. */
  readonly workingCopyId: string;
  /** Zero identifiers for a first revision, one otherwise. */
  readonly parents: readonly string[];
  readonly path: string;
  readonly deleted: boolean;
  /** The content digest, which names the row in the content table. */
  readonly digest: string;
  /** A named checkpoint carries a message; an automatic one does not. */
  readonly message: string | null;
  readonly clientTime: string;
  /** The mutation that submits this checkpoint. */
  readonly mutationId: string;
  /** Set when the server acknowledged the mutation. */
  readonly accepted: boolean;
};

/** Whether a file holds Markdown or an attachment. */
export type LocalFileKind = 'note' | 'attachment';

/**
 * What a caller supplies to keep pending work after access ends.
 *
 * The store adds the partition, the identifier, and the creation time, so
 * the caller names only the file and the reason it was preserved.
 */
export type RecoveryInput = {
  readonly fileId: string;
  readonly path: string;
  readonly text: string;
  readonly reason: RecoveryReason;
  /** The server answer code that refused the save, when there was one. */
  readonly code?: string | null;
  /** The parked queue entry this text came from, when there is one. */
  readonly mutationId?: string | null;
  readonly recoveryId?: string;
  readonly createdAt?: string;
};

/** The pin state of one attachment digest inside one workspace. */
export type AttachmentPin = {
  readonly digest: string;
  readonly pinned: boolean;
};

/**
 * What this device knows about one file.
 *
 * The record mirrors accepted server metadata and adds the local head. The
 * accepted head is what the server last confirmed, and it is the value that a
 * submission puts in `expectedHeads`. The local head is the newest checkpoint
 * this device created; it stays ahead of the accepted head while work is
 * pending, and it never moves backwards on acknowledgment.
 */
export type LocalAcceptedFile = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly fileId: string;
  readonly path: string;
  readonly kind: LocalFileKind;
  /** The accepted head, or `null` when the server has no revision of it. */
  readonly acceptedHeadRevisionId: string | null;
  /** The content digest of the accepted head, when it is known. */
  readonly acceptedHeadDigest: string | null;
  /** The newest local checkpoint, or `null` when none exists. */
  readonly localHeadRevisionId: string | null;
  readonly deleted: boolean;
  readonly updatedAt: string;
};

/**
 * One Markdown note that is ready to open from local storage.
 *
 * `text` is what the editor opens. A draft of this device wins over the
 * accepted head, because only an explicit Save creates a server version.
 *
 * `stale` states that the draft was written over an older accepted head and
 * that its text differs from the current one. The caller then holds both
 * texts: `text` is the draft of this device, and `acceptedText` is the
 * current accepted head. The person chooses; nothing is dropped silently.
 */
export type LocalCachedNote = {
  readonly fileId: string;
  readonly path: string;
  readonly text: string;
  readonly deleted: boolean;
  /** Reuses the newest draft instead of opening a second working copy. */
  readonly workingCopyId?: string | undefined;
  /** Continues the reused draft sequence so later writes stay monotonic. */
  readonly sequence: number;
  /** The local parent that the next checkpoint must name. */
  readonly baseRevisionId: string | null;
  /** A draft over an older accepted head whose text differs from it. */
  readonly stale: boolean;
  /** The current accepted head text, present only for a stale draft. */
  readonly acceptedText: string | null;
  /** The path of the current accepted head, when it is known. */
  readonly acceptedPath: string | null;
  /** The current accepted head revision, when the server confirmed one. */
  readonly acceptedRevisionId: string | null;
};

/**
 * Immutable content, addressed by its digest inside one partition.
 *
 * Markdown carries `text`. An attachment carries `bytes`. Exactly one of the
 * two is set, which the validator checks.
 */
export type LocalContent = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly digest: string;
  readonly text: string | null;
  readonly bytes: Blob | null;
  readonly size: number;
};

/** The stored outcome of one acknowledged mutation. */
export type LocalReceipt = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly mutationId: string;
  readonly revisionIds: readonly string[];
  readonly cursor: string;
  readonly acknowledgedAt: string;
};

/** The commit ordered position this device has consumed. */
export type LocalCursor = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly cursor: string;
  readonly updatedAt: string;
};

/**
 * One downloaded workspace snapshot, staged before it becomes usable.
 *
 * Task 11 owns staging and activation. The table exists here so the schema
 * does not change when that task lands, and so a partly downloaded snapshot
 * is already separated from local drafts.
 */
export type StagedSnapshot = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly token: string;
  readonly revisionIds: readonly string[];
  readonly cursor: string;
  readonly state: 'staging' | 'complete' | 'active';
  readonly createdAt: string;
};

/**
 * One file revision downloaded as part of a staged snapshot.
 *
 * `text` carries Markdown bodies. It is `null` for an attachment revision,
 * whose bytes are fetched on use, and for a tombstone, which carries none.
 */
export type SnapshotRevision = {
  readonly token: string;
  readonly revisionId: string;
  readonly fileId: string;
  readonly path: string;
  readonly kind: LocalFileKind;
  readonly deleted: boolean;
  readonly digest: string;
  readonly text: string | null;
};

/**
 * One file change read from the ordered change feed.
 *
 * `file` is `null` for a membership record, which advances the cursor
 * without touching file metadata.
 */
export type RemoteFileChange = {
  readonly fileId: string;
  readonly revisionId: string;
  readonly path: string;
  readonly fileKind: LocalFileKind;
  readonly deleted: boolean;
  readonly digest: string;
  readonly text: string | null;
};

/**
 * One applied position of the ordered change feed.
 *
 * `file` is `null` for a membership record, which advances the cursor
 * without touching file metadata, and for a permanent deletion, which has no
 * revision left to name. `purgedFileId` names the file of such a deletion, so
 * the local cache can forget it.
 */
export type RemoteChange = {
  readonly file: RemoteFileChange | null;
  /** The file that a permanent deletion removed, or `null`. */
  readonly purgedFileId: string | null;
};

/**
 * One stored setting.
 *
 * `workspaceId` is `accountWide` for a setting that belongs to the account.
 */
export type Preference = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly value: string;
};

/**
 * Why pending work was moved into the recovery area.
 *
 * `save_refused` covers every save the server can never accept. Its `code`
 * names the server answer, so the interface can explain the cause in words.
 * An unknown code stays valid: the interface falls back to one general
 * sentence rather than refusing the record.
 *
 * `stale_draft` is text a person left behind on purpose: the draft of this
 * device was written over an older version, and the person took the newer
 * server text instead. The old text is kept so the choice is reversible.
 */
export type RecoveryReason =
  'purged' | 'sign_out' | 'save_refused' | 'stale_draft';

/**
 * Pending work that the server can no longer accept.
 *
 * A purge and a sign-out keep the user's text for clipboard copying or
 * explicit removal, bound to the account that wrote it.
 */
export type RecoveryRecord = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly recoveryId: string;
  readonly fileId: string;
  readonly path: string;
  readonly text: string;
  readonly reason: RecoveryReason;
  /** The server answer code that refused the save, or `null`. */
  readonly code: string | null;
  /** The parked queue entry this text came from, or `null`. */
  readonly mutationId: string | null;
  readonly createdAt: string;
};

/**
 * Why a local write failed.
 *
 * - `aborted`: the transaction did not commit. Nothing was written.
 * - `quota`: the browser refused the write for lack of space.
 * - `unavailable`: the database is closed, blocked, or absent.
 * - `corrupt`: a stored record does not match its schema, or the stored
 *   schema version is one this application cannot read.
 * - `stale`: the caller supplied a working copy that is older than the
 *   stored one. Nothing was written, so the newer text stays intact.
 */
export type LocalStorageErrorKind =
  'aborted' | 'quota' | 'unavailable' | 'corrupt' | 'stale';

/**
 * A typed local persistence failure.
 *
 * The caller keeps its in-memory buffer, shows Save failed, and stops claiming
 * persistence. It must not discard the text and must not reload the page.
 * The message names no note text and no path, so it is safe to log.
 */
export class LocalStorageError extends Error {
  readonly kind: LocalStorageErrorKind;

  constructor(
    kind: LocalStorageErrorKind,
    detail: string,
    options?: { readonly cause?: unknown },
  ) {
    super(
      `notesapp local storage ${kind}: ${detail}`,
      options?.cause === undefined ? {} : { cause: options.cause },
    );
    this.name = 'LocalStorageError';
    this.kind = kind;
  }
}

/** Whether a thrown value is a local persistence failure. */
export function isLocalStorageError(
  value: unknown,
): value is LocalStorageError {
  return value instanceof LocalStorageError;
}

/**
 * Local persistence for one server origin.
 *
 * Every method is partition bound: the caller names the account, and the
 * workspace comes from the record or from the argument. A method never reads
 * or writes outside that partition.
 *
 * Every method rejects with a `LocalStorageError` when the browser database
 * fails. No method returns a partial result.
 */
export type LocalStore = {
  /** The origin this store belongs to. */
  readonly serverOrigin: string;

  /**
   * The device identity that submissions carry.
   *
   * It is stored with the database, so it survives a restart and a mutation
   * retry keeps naming the same device.
   */
  readonly deviceId: string;

  /** Subscribes to committed local changes. */
  subscribe(listener: (change: LocalChange) => void): () => void;

  /**
   * Writes the working text of one editor in one transaction.
   *
   * The design's target is at most 150 ms after input. A write with a lower
   * `sequence` than the stored one is ignored, so a late save cannot undo a
   * newer one.
   */
  saveDraft(draft: Draft): Promise<void>;

  /** Reads one working copy, or `null` when it has no stored draft. */
  readDraft(
    accountId: string,
    workspaceId: string,
    workingCopyId: string,
  ): Promise<Draft | null>;

  /**
   * Moves the base of one working copy to the current accepted head.
   *
   * Used when a person keeps a draft that was written over an older head.
   * The text is untouched; only the parent that the next checkpoint names
   * changes, so the following Save reaches the server instead of naming a
   * head the server no longer has. Does nothing when no draft is stored.
   */
  rebaseDraft(
    accountId: string,
    workspaceId: string,
    workingCopyId: string,
  ): Promise<void>;

  /**
   * Removes one working copy draft.
   *
   * Used when a person takes the accepted head instead of a stale draft.
   * The caller keeps the text first, in the recovery area or the clipboard.
   * Checkpoints and queue entries are never touched.
   */
  dropDraft(
    accountId: string,
    workspaceId: string,
    workingCopyId: string,
  ): Promise<void>;

  /**
   * Creates one immutable checkpoint and queues its mutation.
   *
   * Content, the checkpoint, the local head, and the queue entry commit in one
   * transaction, so a queued mutation always has its content. Returns `null`
   * when the checkpoint is suppressed because the content, the path, and the
   * deletion state are unchanged and no message was given.
   *
   * Rejects with a `stale` failure when the stored draft of the same working
   * copy is newer than the supplied one. An older buffer must never become
   * an immutable version, so nothing is written and the caller flushes its
   * newest text first.
   *
   * A new checkpoint always becomes the local head. The server rebases it on
   * the current accepted head when another save reached the server first.
   */
  checkpoint(draft: Draft, message: string | null): Promise<QueueEntry | null>;

  /** The queued mutations of one workspace, in submission order. */
  pending(
    accountId: string,
    workspaceId: string,
  ): Promise<readonly QueueEntry[]>;

  /**
   * Freezes the request digest of one queued mutation and marks it sending.
   *
   * The body cannot change after this point, so a retry repeats the same
   * operation.
   */
  markSending(
    accountId: string,
    mutationId: string,
    digest: string,
  ): Promise<void>;

  /**
   * Marks one queued mutation as conflicting, keeping its body.
   *
   * `errorCode` is optional, so a caller that does not know why the server
   * refused the mutation keeps the stored reason.
   */
  markConflict(
    accountId: string,
    mutationId: string,
    details?: { readonly errorCode?: string | null },
  ): Promise<void>;

  /**
   * Removes one queued mutation and the local work that only it held.
   *
   * Used when the server refused the mutation for good and repeating it can
   * never help, for example a deletion that the server refused because the
   * note changed on another device. The queue entry, the checkpoints of the
   * mutation, and the local head that they set are removed in one
   * transaction, so the file goes back to its accepted state. A deletion flag
   * that the discarded mutation set is cleared as well, because the accepted
   * head that the server kept is not a tombstone.
   *
   * Discarding an unknown mutation does nothing.
   */
  discardQueueEntry(accountId: string, mutationId: string): Promise<void>;

  /**
   * Moves the preconditions of one queued mutation to the current heads.
   *
   * Used after the server refused a mutation with a failed precondition and
   * the client has read the accepted state again. Only a mutation that still
   * waits may move, so a frozen body is never rewritten: the answer is `null`
   * when the mutation is unknown or already sent. The frozen digest is
   * cleared with the change, because the body that the next send covers is
   * not the body that the digest names.
   */
  reparentQueueEntry(
    accountId: string,
    mutationId: string,
    expectedHeads: Readonly<Record<string, string | null>>,
  ): Promise<QueueEntry | null>;

  /**
   * Applies one server acknowledgment.
   *
   * Removes exactly the acknowledged mutation's queue entry, marks its
   * checkpoints accepted, moves the accepted heads to the acknowledged
   * revisions, advances the mutable precondition of its first pending child,
   * and stores the receipt, in one transaction. Drafts and checkpoints created
   * after the submission are preserved. Acknowledging the same mutation twice
   * does nothing.
   */
  acknowledge(accountId: string, result: AcceptedChangeset): Promise<void>;

  /** The local checkpoints of one file, oldest first. */
  listCheckpoints(
    accountId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<readonly CheckpointRecord[]>;

  /**
   * The recovery area of one account and workspace.
   *
   * Recovery records stay bound to the account that wrote them. A caller
   * shows them only after that same account signs in again.
   */
  recover(
    accountId: string,
    workspaceId: string,
  ): Promise<readonly RecoveryRecord[]>;

  /**
   * Keeps one pending text in the account-bound recovery area.
   *
   * Used when a purge or a sign-out leaves local work that the server can no
   * longer accept. The record stays under the original account for clipboard
   * copying or explicit removal.
   */
  addRecovery(
    accountId: string,
    workspaceId: string,
    entry: RecoveryInput,
  ): Promise<RecoveryRecord>;

  /** Removes one recovery record of the calling account. */
  removeRecovery(
    accountId: string,
    workspaceId: string,
    recoveryId: string,
  ): Promise<void>;

  /** The accepted file metadata of one workspace, ordered by path. */
  listAcceptedFiles(
    accountId: string,
    workspaceId: string,
  ): Promise<readonly LocalAcceptedFile[]>;

  /** Files known from accepted metadata or durable drafts. */
  listLocalFiles(
    accountId: string,
    workspaceId: string,
  ): Promise<readonly LocalFileSummary[]>;

  /** Save state derived only from records of one file. */
  readFileSaveSnapshot(
    accountId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<FileSaveSnapshot>;

  /** Refused queue records of one workspace, for the Needs attention list. */
  listLocalConflicts(
    accountId: string,
    workspaceId: string,
  ): Promise<readonly LocalConflict[]>;

  /**
   * Reads one cached note, with the newest saved draft applied.
   *
   * The draft is compared with the accepted head before it is returned. A
   * draft that matches the accepted head is removed and the head is
   * returned, so one keystroke cannot shadow newer server text for good. A
   * draft over an older head whose text differs is returned with `stale`
   * set and with the accepted head text beside it.
   */
  readCachedNote(
    accountId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<LocalCachedNote | null>;

  /** Accepted local note bodies with current drafts applied over them. */
  listSearchFiles(
    accountId: string,
    workspaceId: string,
  ): Promise<readonly LocalSearchFile[]>;

  /** Whether the content body of one digest is stored locally. */
  hasContent(
    accountId: string,
    workspaceId: string,
    digest: string,
  ): Promise<boolean>;

  /** Pins or unpins one attachment digest for offline use. */
  setAttachmentPinned(
    accountId: string,
    workspaceId: string,
    digest: string,
    pinned: boolean,
  ): Promise<void>;

  /** Whether one attachment digest is pinned for offline use. */
  isAttachmentPinned(
    accountId: string,
    workspaceId: string,
    digest: string,
  ): Promise<boolean>;

  /** Pins or unpins one historic revision for offline use. */
  setHistoryPinned(
    accountId: string,
    workspaceId: string,
    revisionId: string,
    pinned: boolean,
  ): Promise<void>;

  /** Whether one historic revision is pinned for offline use. */
  isHistoryPinned(
    accountId: string,
    workspaceId: string,
    revisionId: string,
  ): Promise<boolean>;

  /**
   * Records that one account signed out while offline.
   *
   * The marker survives `clearPrivateData` so reconnect can revoke the
   * server session before any private content is restored. It is cleared
   * only after that revocation succeeds.
   */
  setSignOutMarker(accountId: string): Promise<void>;

  /** Whether one account carries a pending offline sign-out marker. */
  hasSignOutMarker(accountId: string): Promise<boolean>;

  /** Clears the offline sign-out marker after revocation succeeds. */
  clearSignOutMarker(accountId: string): Promise<void>;

  /**
   * Deletes the private local data of one account.
   *
   * With a workspace ID only that partition is cleared, otherwise every
   * workspace of the account. Drafts, checkpoints, contents, accepted
   * metadata, queue entries, receipts, staged snapshots, cursors, recovery
   * records, and workspace preferences are removed. The account-wide
   * sign-out marker and the device identity survive.
   */
  clearPrivateData(accountId: string, workspaceId?: string): Promise<void>;

  /** The current sync worker lease, or `null` when none is stored. */
  readLeaseState(): Promise<{
    readonly ownerId: string;
    readonly expiresAt: number;
  } | null>;

  /**
   * Takes the single sync worker lease of this store.
   *
   * Returns `true` and records `ownerId` with `expiresAt` (milliseconds since
   * the Unix epoch) when no lease exists, when the stored one already expired,
   * or when this owner already holds it. Returns `false` when another owner
   * holds a live lease. A worker whose lease expired without renewal has
   * failed, so another worker may take over.
   */
  acquireLease(ownerId: string, expiresAt: number): Promise<boolean>;

  /**
   * Gives up the sync worker lease.
   *
   * Removes the lease only when `ownerId` holds it. Releasing a lease that
   * another worker took over does nothing.
   */
  releaseLease(ownerId: string): Promise<void>;

  /**
   * Records the plan of one downloaded snapshot before its content arrives.
   *
   * `revisionIds` names every immutable revision the snapshot captured, and
   * `cursor` is the captured high-water position. Staging never touches
   * drafts, checkpoints, the queue, or accepted metadata.
   *
   * The plan sketch names only the token, the revisions, and the cursor. The
   * account and the workspace travel explicitly because every port method is
   * partition bound: the token alone cannot place the staged row.
   */
  stageSnapshot(
    accountId: string,
    workspaceId: string,
    token: string,
    revisionIds: readonly string[],
    cursor: string,
  ): Promise<void>;

  /**
   * Stores one downloaded snapshot revision in the staging area.
   *
   * Markdown text is stored by its digest; attachment revisions keep their
   * metadata so their bytes can be fetched on use. Nothing becomes accepted
   * metadata until `activateSnapshot` runs.
   */
  storeSnapshotRevision(
    accountId: string,
    workspaceId: string,
    revision: SnapshotRevision,
  ): Promise<void>;

  /**
   * Makes a fully downloaded snapshot the accepted state.
   *
   * Rejects with an `aborted` failure when any staged revision or its
   * required content is still missing; the caller then restarts the download
   * and keeps its local work. Otherwise advances accepted heads and the
   * cursor in one transaction. Files with unsubmitted local work keep their
   * local head, their drafts, and their queued mutations: a remote head never
   * replaces a dirty working copy. A draft that differs from the snapshot
   * head counts as local work.
   */
  activateSnapshot(token: string): Promise<void>;

  /** The commit ordered position this device consumed, or `null`. */
  readCursor(accountId: string, workspaceId: string): Promise<string | null>;

  /**
   * Applies ordered remote changes and advances the cursor.
   *
   * Every file change updates the accepted head and stores its content;
   * files with unsubmitted local work keep their local head and drafts. A
   * file counts as having local work when its local head is ahead of its
   * accepted head, and also when a draft of it differs from the incoming
   * head.
   * Records without a file only advance the cursor. The whole batch and the
   * cursor commit in one transaction.
   */
  applyRemoteChanges(
    accountId: string,
    workspaceId: string,
    changes: readonly RemoteChange[],
    nextCursor: string,
  ): Promise<void>;

  /**
   * Forgets every local trace of files that the server purged.
   *
   * A permanently deleted file leaves no row on the server, so a client that
   * still holds its accepted metadata, its drafts, its checkpoints, its queued
   * mutations, or its recovery copies would keep the note in the tree or revive
   * it on the next re-send. This removes all of them for the named files in one
   * transaction. Content bodies stay, because one body can back several files.
   */
  forgetPurgedFiles(
    accountId: string,
    workspaceId: string,
    fileIds: readonly string[],
  ): Promise<void>;

  /** Closes the database connection. A schema upgrade needs every tab to. */
  close(): Promise<void>;
};
