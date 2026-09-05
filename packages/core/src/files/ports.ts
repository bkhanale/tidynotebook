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
export type MutationReceipt = {
  readonly digest: string;
  readonly outcome: AcceptedChangeset;
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
  receipt(
    mutationId: string,
    accountId: string,
  ): Promise<MutationReceipt | null>;
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
  /** Whether the file identifier was permanently purged in this workspace. */
  isPurged(fileId: string): Promise<boolean>;
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
