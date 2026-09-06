/**
 * Shared file domain types.
 *
 * These types describe what a client asks the workspace to accept and what an
 * accepted change looks like. They are separate from HTTP request models and
 * from storage rows. A transport adapter maps its own validated types to these
 * types; it never passes a parsed request body through as a domain value.
 *
 * Every identifier is a UUID string that the transport and the storage
 * boundaries validate. Domain code compares identifiers; it does not parse
 * them.
 */

/**
 * Immutable content of one revision, addressed by its digest.
 *
 * Markdown content carries its text. Attachment content carries the identity
 * of a finalized immutable object, never its bytes.
 */
export type ContentRef =
  | {
      readonly kind: 'markdown';
      readonly digest: string;
      readonly text: string;
    }
  | {
      readonly kind: 'attachment';
      readonly digest: string;
      readonly objectId: string;
    };

/**
 * One revision that a client submits.
 *
 * `parents` holds zero identifiers for the first revision of a new file, one
 * for a normal revision, and two for an explicit merge. The actor and the
 * acceptance time are added by the workspace; a client cannot supply them.
 * `clientTime` stays informational.
 */
export type RevisionInput = {
  readonly id: string;
  readonly fileId: string;
  readonly parents: readonly string[];
  readonly path: string;
  readonly deleted: boolean;
  readonly content: ContentRef;
  readonly clientTime: string;
  readonly message: string | null;
  readonly restoredFrom: string | null;
};

/**
 * One atomic operation over one or more files.
 *
 * `expectedHeads[fileId]` is the accepted head that the client saw. The value
 * `null` means that the file must not exist in accepted state. `mutationId`
 * identifies a retry of the same operation.
 */
export type ChangesetInput = {
  readonly workspaceId: string;
  readonly mutationId: string;
  readonly deviceId: string;
  readonly expectedHeads: Readonly<Record<string, string | null>>;
  readonly revisions: readonly RevisionInput[];
};

/**
 * One revision as the workspace accepted it.
 *
 * The record carries the values that the workspace assigned: the verified
 * actor and the acceptance time. It carries no note text. A client that
 * submitted the revision already holds its content, and a caller that may not
 * read the workspace must not receive content through a write answer.
 */
export type AcceptedRevision = {
  readonly revisionId: string;
  readonly fileId: string;
  readonly parents: readonly string[];
  readonly path: string;
  readonly deleted: boolean;
  readonly digest: string;
  /** Size of the content in bytes. */
  readonly size: number;
  readonly actorAccountId: string;
  readonly serverTime: string;
  readonly message: string | null;
};

/**
 * The outcome of an accepted changeset, also stored as a mutation receipt.
 *
 * The accepted revisions travel with the outcome, so an answer to a write is
 * built from the write itself rather than from a later read. A retry of the
 * same mutation therefore repeats the same records, and a caller that may
 * write but not read still receives its own acknowledgement.
 */
export type AcceptedChangeset = {
  readonly mutationId: string;
  readonly revisionIds: readonly string[];
  readonly cursor: string;
  readonly revisions: readonly AcceptedRevision[];
};

/**
 * A stable domain failure code.
 *
 * Each code is an expected outcome of a valid request, so a caller can map it
 * to a documented problem response. An infrastructure failure is not a domain
 * error; see `OperationalError` in `./ports.ts`.
 *
 * `invalid_content` means that submitted content does not match its declared
 * digest. Storage checks this, because a wrong digest would attach a revision
 * to bytes that the client never sent.
 *
 * `snapshot_required` means that a snapshot expired, is unknown, was
 * invalidated by a purge, or that a sync cursor predates the retained event
 * window. The client starts a fresh snapshot and keeps its local work.
 *
 * `unsupported_version` means that the client asked for a sync protocol
 * version that this server does not serve. The request changes nothing.
 */
export type DomainErrorCode =
  | 'forbidden'
  | 'stale_head'
  | 'path_conflict'
  | 'invalid_path'
  | 'invalid_graph'
  | 'invalid_content'
  | 'quota'
  | 'purged'
  | 'mutation_reused'
  | 'snapshot_required'
  | 'unsupported_version'
  | 'not_found';

/**
 * A domain failure and the files it refers to.
 *
 * `fileIds` names the files that a caller must show or resolve. It is empty
 * when the failure has no file, for example a denied permission check. The
 * error carries no note content and no path, so it is safe to log.
 */
export type DomainError = {
  readonly code: DomainErrorCode;
  readonly fileIds: readonly string[];
};

/**
 * The result of a domain operation.
 *
 * Expected failures are returned, not thrown. An exception in this package
 * means a defect or an infrastructure failure.
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DomainError };

/** Wraps a successful value. Use `ok(undefined)` for a `Result<void>`. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Wraps a domain failure. `fileIds` stays empty when no file is involved. */
export function fail<T>(
  code: DomainErrorCode,
  fileIds: readonly string[] = [],
): Result<T> {
  return { ok: false, error: { code, fileIds: [...fileIds] } };
}
