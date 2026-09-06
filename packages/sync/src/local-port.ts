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

/** Where one queued mutation stands. */
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

/**
 * A divergent local tip of one file.
 *
 * Two working copies of one file that both checkpoint produce two tips over
 * one base. The design forbids a silent merge, so both are kept and the user
 * resolves them.
 */
export type LocalBranch = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly branchId: string;
  readonly fileId: string;
  /** The revision both tips descend from, or `null` for two new files. */
  readonly baseRevisionId: string | null;
  /** The two divergent tips, the existing local head first. */
  readonly tips: readonly string[];
  readonly resolved: boolean;
  readonly createdAt: string;
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
 * `file` is `null` for a membership or share record, which advances the
 * cursor without touching file metadata.
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

/** One applied position of the ordered change feed. */
export type RemoteChange = {
  readonly file: RemoteFileChange | null;
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

/** Why pending work was moved into the recovery area. */
export type RecoveryReason =
  'access_revoked' | 'role_downgraded' | 'purged' | 'sign_out';

/**
 * Pending work that the server can no longer accept.
 *
 * The design requires that revoked access, a downgrade to viewer, and a purge
 * keep the user's text for clipboard copying or explicit removal, bound to the
 * account that wrote it. Task 17 owns the screens and the writers; this record
 * and the read below are their storage contract.
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
 */
export type LocalStorageErrorKind =
  'aborted' | 'quota' | 'unavailable' | 'corrupt';

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
   * Creates one immutable checkpoint and queues its mutation.
   *
   * Content, the checkpoint, the local head, and the queue entry commit in one
   * transaction, so a queued mutation always has its content. Returns `null`
   * when the checkpoint is suppressed because the content, the path, and the
   * deletion state are unchanged and no message was given.
   *
   * When another working copy of the same file already advanced the local
   * head, the new checkpoint is a divergent tip: a branch is recorded and the
   * local head does not move.
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

  /** Marks one queued mutation as conflicting, keeping its body. */
  markConflict(accountId: string, mutationId: string): Promise<void>;

  /**
   * Applies one server acknowledgment.
   *
   * Removes exactly the acknowledged mutation's queue entry, marks its
   * checkpoints accepted, moves the accepted heads to the acknowledged
   * revisions, and stores the receipt, in one transaction. Drafts and
   * checkpoints created after the submission are preserved. Acknowledging the
   * same mutation twice does nothing.
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
   * Task 17 adds the writers and the removal actions. The read exists now so
   * the table and its partition rule are fixed with the rest of the schema.
   */
  recover(
    accountId: string,
    workspaceId: string,
  ): Promise<readonly RecoveryRecord[]>;

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
   * replaces a dirty working copy.
   */
  activateSnapshot(token: string): Promise<void>;

  /** The commit ordered position this device consumed, or `null`. */
  readCursor(accountId: string, workspaceId: string): Promise<string | null>;

  /**
   * Applies ordered remote changes and advances the cursor.
   *
   * Every file change updates the accepted head and stores its content;
   * files with unsubmitted local work keep their local head and drafts.
   * Records without a file only advance the cursor. The whole batch and the
   * cursor commit in one transaction.
   */
  applyRemoteChanges(
    accountId: string,
    workspaceId: string,
    changes: readonly RemoteChange[],
    nextCursor: string,
  ): Promise<void>;

  /** Closes the database connection. A schema upgrade needs every tab to. */
  close(): Promise<void>;
};
