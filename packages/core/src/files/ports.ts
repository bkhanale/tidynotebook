/**
 * Storage ports for workspace content.
 *
 * The core owns these interfaces; a server storage package implements them.
 * The core imports no database driver, no HTTP framework, and no generated
 * client, so the same rules run in the browser and on the server.
 *
 * Every port method belongs to one open workspace transaction. The lock order
 * of a change is the workspace, then the mutation identity, then the affected
 * files sorted by identifier. `transact` acquires the workspace lock, and the
 * use case runs its reads and its `accept` call inside that one transaction.
 */
import type { Actor, Role } from '../identity/actor.ts';
import type { AcceptedChangeset, ChangesetInput, Result } from './model.ts';

/** A stored outcome of an earlier accepted changeset, kept for safe retries. */
export type MutationReceipt<T = AcceptedChangeset> = {
  readonly digest: string;
  readonly outcome: T;
};

/** Whether a file holds Markdown or an attachment. */
export type FileKind = 'note' | 'attachment';

/**
 * The accepted state of one file.
 *
 * These are the public members of a file. A storage row also holds the
 * workspace and internal bookkeeping, which never leaves the storage layer.
 */
export type FileRecord = {
  readonly fileId: string;
  readonly path: string;
  readonly kind: FileKind;
  /** The accepted head, or `null` for a file that has no accepted revision. */
  readonly headRevisionId: string | null;
  readonly deleted: boolean;
  /** Instant of the last accepted change, as an ISO 8601 string. */
  readonly updatedAt: string;
};

/** One page of accepted files, ordered by file identifier. */
export type FilePage = {
  readonly files: readonly FileRecord[];
  /** The cursor of the next page, or `null` when this page is the last. */
  readonly nextCursor: string | null;
};

/** What a caller asks for when it reads a page of files. */
export type PageRequest = {
  /** The last file identifier of the previous page, or `null` to start. */
  readonly cursor: string | null;
  readonly limit: number;
};

/**
 * One immutable revision and the content it names.
 *
 * `text` carries Markdown. An attachment revision carries `objectId` instead,
 * and its bytes are transferred through the attachment operations.
 */
export type RevisionRecord = {
  readonly revisionId: string;
  readonly fileId: string;
  readonly path: string;
  readonly kind: FileKind;
  readonly deleted: boolean;
  readonly parents: readonly string[];
  readonly digest: string;
  /** Size of the content in bytes. */
  readonly size: number;
  readonly text: string | null;
  readonly objectId: string | null;
  readonly message: string | null;
  readonly restoredFrom: string | null;
  readonly clientTime: string;
  readonly serverTime: string;
};

/** Reads and the one write of an open workspace transaction. */
export type WorkspaceTransaction = {
  /** The account's current role in this workspace, or `null` for a stranger. */
  role(accountId: string): Promise<Role | null>;
  /**
   * The receipt of an earlier mutation of the same actor, or `null`. The
   * lookup is bound to the actor, so a replay cannot use another account's
   * outcome.
   */
  receipt<T = AcceptedChangeset>(
    mutationId: string,
    accountId: string,
  ): Promise<MutationReceipt<T> | null>;
  /**
   * The accepted head of each requested file. The value is `null` when the
   * file does not exist in accepted state. A missing key means the same.
   */
  heads(
    fileIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>>;
  /**
   * The owning file of each requested stored revision. A revision that this
   * workspace does not hold is absent from the result. The value feeds the
   * `known` argument of `validateGraph`.
   */
  parents(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /**
   * The requested file identifiers that were permanently purged.
   *
   * The lookup takes every file of a changeset at once, because a folder
   * change asks about up to 1000 files and one query per file would be one
   * round trip per file.
   */
  purgedFiles(fileIds: readonly string[]): Promise<readonly string[]>;
  /**
   * One page of the live files of this workspace, ordered by identifier.
   *
   * A deleted file is left out, because it holds no place in the file tree.
   * Its history stays reachable through its revisions.
   */
  listFiles(page: PageRequest): Promise<FilePage>;
  /** One file of this workspace, or `null` when it holds no such file. */
  file(fileId: string): Promise<FileRecord | null>;
  /** One revision of this workspace, or `null` when it holds no such one. */
  revision(revisionId: string): Promise<RevisionRecord | null>;
  /**
   * Performs the atomic write of one changeset.
   *
   * The implementation writes the immutable content and revisions, advances
   * every head, updates the indexes, allocates the sync cursor, and stores the
   * receipt. It enforces the persistent invariants that only storage can
   * check: uniqueness of the final accepted paths, including a valid atomic
   * path swap, and the workspace quota. It assigns the verified actor and the
   * server time; a client supplied actor or acceptance time is ignored.
   *
   * Either every file change commits or none does. `accept` runs inside the
   * transaction that `transact` opened and does not start a nested
   * transaction. An expected failure such as `path_conflict` or `quota` is
   * returned as a `Result`; an infrastructure failure throws an
   * `OperationalError`.
   */
  accept(
    actor: Actor,
    input: ChangesetInput,
    digest: string,
  ): Promise<Result<AcceptedChangeset>>;
  /**
   * Removes the accepted side records of files that a changeset deleted.
   *
   * A deletion revokes the shares of the file and removes it from normal
   * search, and both have to happen in the transaction that accepted the
   * tombstone. Otherwise a share would stay readable, or a crash between two
   * transactions would leave one behind.
   *
   * There is one port method rather than one per index, because every caller
   * needs all of them and a later index must not be forgotten at a call site.
   * The implementation revokes shares and drops link records today; the search
   * task extends the same implementation, and no caller changes.
   *
   * The call runs after `accept` inside the same transaction. It never adds
   * content, so a full workspace can still delete a file.
   */
  onFilesDeleted(fileIds: readonly string[]): Promise<void>;
  /** One page of history revisions for one file, ordered newest first. */
  listHistory(fileId: string, page: PageRequest): Promise<HistoryPage>;
  /** Divergent branches of this workspace. */
  listBranches(filter?: BranchFilter): Promise<readonly BranchRecord[]>;
  /** Marks open branches resolved by their tip revision identifiers. */
  markBranchesResolved(
    branchTipRevisionIds: readonly string[],
  ): Promise<readonly string[]>;
  /** Submits a branch without advancing accepted heads. */
  acceptBranch(
    actor: Actor,
    input: SubmitBranchInput,
    digest: string,
  ): Promise<Result<AcceptedBranch>>;
  /** Previews permanent deletion of the requested files. */
  previewPurge(fileIds: readonly string[]): Promise<Result<PurgePreview>>;
  /** Permanently deletes files and writes purge markers. */
  purgeFiles(
    actor: Actor,
    mutationId: string,
    fileIds: readonly string[],
    digest: string,
  ): Promise<Result<PurgedFilesResult>>;
  /**
   * Captures accepted metadata and the high-water cursor in one transaction.
   *
   * The implementation reads the live files and the workspace cursor under
   * repeatable read (see `TransactOptions`), materializes one item per live
   * file with its immutable head revision, stores the rows under a random
   * opaque token kept as a hash, and returns the token with the captured
   * cursor. It evicts the oldest open snapshot past the admission limit
   * instead of refusing the call.
   */
  startSnapshot(input: StartSnapshotInput): Promise<SnapshotStart>;
  /**
   * Reads one page of a materialized snapshot.
   *
   * The read runs in its own short transaction: no transaction stays open
   * across network pages. The answer is `null` when the token is unknown, the
   * snapshot expired, or a purge removed one of its pinned revisions. The
   * caller maps `null` to `snapshot_required`.
   */
  snapshotPage(
    token: string,
    position: number,
    limit: number,
  ): Promise<SnapshotPage | null>;
  /**
   * Reads the ordered change records after one cursor.
   *
   * The answer carries the rows, the current high-water cursor, and the oldest
   * retained cursor, so the caller can tell an empty poll from a cursor that
   * predates the retained window.
   */
  syncChanges(afterCursor: string, limit: number): Promise<SyncChangeFeed>;
};

/** One historic revision item for history listing. */
export type HistoryRevision = {
  readonly revisionId: string;
  readonly fileId: string;
  readonly path: string;
  readonly deleted: boolean;
  readonly parents: readonly string[];
  readonly digest: string;
  readonly size: number;
  readonly actorAccountId: string;
  readonly clientTime: string;
  readonly serverTime: string;
  readonly message: string | null;
  readonly isCheckpoint: boolean;
  readonly checkpointName: string | null;
  readonly restoredFrom: string | null;
  readonly text: string | null;
  readonly objectId: string | null;
};

/** One page of history revisions. */
export type HistoryPage = {
  readonly revisions: readonly HistoryRevision[];
  readonly nextCursor: string | null;
};

/** State of a divergent branch. */
export type BranchState = 'unresolved' | 'resolved';

/** One recorded divergent branch. */
export type BranchRecord = {
  readonly id: string;
  readonly workspaceId: string;
  readonly fileId: string;
  readonly baseRevisionId: string | null;
  readonly tipRevisionId: string;
  readonly conflictGroupId: string;
  readonly state: BranchState;
  readonly createdAt: string;
};

/** Optional filter criteria when querying branches. */
export type BranchFilter = {
  readonly fileId?: string;
  readonly conflictGroupId?: string;
  readonly state?: BranchState;
};

/** Input payload when submitting a divergent branch. */
export type SubmitBranchInput = ChangesetInput & {
  readonly conflictGroupId: string;
};

/** Stored outcome of an accepted branch submission. */
export type AcceptedBranch = {
  readonly mutationId: string;
  readonly conflictGroupId: string;
  readonly revisionIds: readonly string[];
  readonly branches: readonly BranchRecord[];
};

/** A reference that prevents permanent deletion of a file. */
export type BlockingReference = {
  readonly kind: 'revision' | 'branch' | 'share';
  readonly targetId: string;
  readonly referrerId: string;
  readonly description: string;
};

/** Preview summary of an intended purge operation. */
export type PurgePreview = {
  readonly fileIds: readonly string[];
  readonly revisionIds: readonly string[];
  readonly contentDigests: readonly string[];
  readonly attachmentObjectIds: readonly string[];
  readonly blockingReferences: readonly BlockingReference[];
  readonly dependentRevisionCount: number;
  readonly reclaimableBytes: number;
  readonly canPurge: boolean;
};

/** Outcome of an executed permanent file purge. */
export type PurgedFilesResult = {
  readonly mutationId: string;
  readonly purgedFileIds: readonly string[];
  readonly purgedRevisionIds: readonly string[];
  readonly reclaimedBytes: number;
};

/** The kind of entity that one incremental sync record refers to. */
export type SyncEntityKind = 'file' | 'membership' | 'share';

/** What a caller asks for when it starts a snapshot. */
export type StartSnapshotInput = {
  /** Largest number of items in one snapshot page. */
  readonly pageSize: number;
};

/**
 * One pinned file inside a snapshot.
 *
 * The revision identifier is immutable: later commits cannot change what a
 * page shows. Content transfer reuses the revision read by this identifier,
 * never the later current head.
 */
export type SnapshotItem = {
  readonly fileId: string;
  readonly revisionId: string;
  readonly path: string;
  readonly kind: FileKind;
  readonly deleted: boolean;
};

/** The captured state that a snapshot start returns. */
export type SnapshotStart = {
  /** Opaque token that addresses the materialized pages. */
  readonly token: string;
  /** Instant at which the snapshot expires, as an ISO 8601 string. */
  readonly expiresAt: string;
  /** The captured high-water cursor, as a decimal string. */
  readonly cursor: string;
  /** How many items the snapshot captured. */
  readonly itemCount: number;
  /** The page size stored with the snapshot. */
  readonly pageSize: number;
};

/** One page of a materialized snapshot. */
export type SnapshotPage = {
  /** The token of the snapshot, echoed for the client. */
  readonly token: string;
  /** The captured high-water cursor, as a decimal string. */
  readonly cursor: string;
  /** Instant at which the snapshot expires, as an ISO 8601 string. */
  readonly expiresAt: string;
  /** Ordinal of the first item of this page. */
  readonly position: number;
  /** Ordinal of the next page, or `null` when this page is the last. */
  readonly nextPosition: number | null;
  /** How many items the snapshot holds now. */
  readonly totalItems: number;
  readonly items: readonly SnapshotItem[];
};

/** One commit ordered incremental change record. */
export type SyncChange = {
  /** The commit ordered position of this change, as a decimal string. */
  readonly cursor: string;
  readonly entityKind: SyncEntityKind;
  readonly entityId: string;
  /** The revision of a file change, or `null` for a non-file change. */
  readonly revisionId: string | null;
  readonly deleted: boolean;
};

/** The raw feed that one incremental sync read returns. */
export type SyncChangeFeed = {
  /** Ordered changes after the requested cursor, oldest first. */
  readonly changes: readonly SyncChange[];
  /** The current high-water cursor, as a decimal string. */
  readonly highWater: string;
  /** The oldest retained cursor, or `null` when no record is retained. */
  readonly oldestRetained: string | null;
};

/** One page of incremental changes with the cursor to continue from. */
export type SyncPage = {
  readonly changes: readonly SyncChange[];
  /** The cursor the client sends to continue, as a decimal string. */
  readonly nextCursor: string;
};

/** Options of one open workspace transaction. */
export type TransactOptions = {
  /**
   * The isolation level of the transaction.
   *
   * A snapshot capture asks for `repeatable-read`, so the captured metadata
   * and its high-water cursor come from one stable view. Every other use case
   * leaves this absent and keeps the default level.
   */
  readonly isolation?: 'repeatable-read';
};

/** Opens one workspace transaction for a verified actor. */
export type WorkspaceStore = {
  /**
   * Runs `run` inside one workspace transaction and commits when it returns.
   * The transaction rolls back when `run` throws. The actor identity is set on
   * the connection, so row access policies apply to every statement.
   */
  transact<T>(
    actor: Actor,
    workspaceId: string,
    run: (tx: WorkspaceTransaction) => Promise<T>,
    options?: TransactOptions,
  ): Promise<T>;
};

/** The kind of infrastructure failure that an adapter reports. */
export type OperationalErrorKind =
  'unavailable' | 'timeout' | 'serialization' | 'unexpected';

/**
 * An infrastructure failure, such as an unreachable database or a lock
 * timeout.
 *
 * This is not a `DomainError`. A domain error is an expected outcome of a
 * valid request and is returned as a `Result`. An `OperationalError` is thrown,
 * and the HTTP adapter maps it to a generic server error that carries the
 * request identifier and no stored content. Keep the message free of note
 * content, paths, and secrets.
 */
export class OperationalError extends Error {
  readonly kind: OperationalErrorKind;

  constructor(
    kind: OperationalErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OperationalError';
    this.kind = kind;
  }
}

/** Whether a caught value is an infrastructure failure of a storage port. */
export function isOperationalError(value: unknown): value is OperationalError {
  return value instanceof OperationalError;
}
