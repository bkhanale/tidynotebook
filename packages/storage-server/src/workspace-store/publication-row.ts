/**
 * The parser of one stored published link, and the shape of its scope bound.
 *
 * A column type proves very little about a row. `scope_kind` is an enum, but
 * nothing in the type says that the row also holds the one member that the
 * kind needs, and a timestamp column answers a driver value rather than a
 * domain instant. This module turns one row into the record that
 * `packages/core` declares, and it throws `OperationalError` on anything else,
 * as `../attachment-row.ts` does. Decision 0019 asks for a parser that fails
 * loudly instead of a type assertion.
 *
 * Nothing here answers a secret. The lookup function of the migration returns
 * no token digest and no password digest, so the parsed record cannot carry
 * one either.
 */
import { OperationalError, folderScopePrefix } from '@notesapp/core';
import type { PublicationScope, PublishedLink } from '@notesapp/core';

/** A stored secret is a SHA-256 in lower case hexadecimal. */
const secretDigestPattern = /^[0-9a-f]{64}$/;

/**
 * Whether a value has the shape that a digest column accepts.
 *
 * The two digest columns carry the same rule as a check constraint, so a value
 * of another shape can never be at rest. A caller that holds such a value has
 * a defect, and the reader path answers `null` for it rather than sending a
 * value that the database would refuse.
 */
export function isSecretDigest(value: string): boolean {
  return secretDigestPattern.test(value);
}

/**
 * Escapes the wildcards of a `LIKE` bound.
 *
 * A stored path may hold `%` and `_`, which `LIKE` reads as wildcards. A path
 * holds no backslash, because `normalizePath` refuses one, so the default
 * escape character of `LIKE` is free for this use.
 */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** One row of the lookup function, before anything is known about it. */
export type PublicationLookupRow = Record<string, unknown>;

/**
 * One published link as the repository holds it while the transaction is open.
 *
 * The bound members are read once, at the lookup, and every later query of
 * that transaction builds its scope from them. A caller hands over a link
 * record and never a bound, so no caller can widen one.
 */
export type StoredPublication = {
  readonly link: PublishedLink;
  /** The account whose identity the transaction adopts for the row policies. */
  readonly ownerAccountId: string;
  /** The note of a note link, or `null` for a folder link. */
  readonly scopeFileId: string | null;
  /** The stored path prefix of a folder link, or `null` for a note link. */
  readonly scopePrefix: string | null;
};

/** Refuses a stored row that the domain cannot read. */
function refuse(what: string): never {
  throw new OperationalError(
    'unexpected',
    `notesapp: a stored published link ${what}.`,
  );
}

/** One text column of the row. */
function text(row: PublicationLookupRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string' || value.length === 0)
    refuse(`holds no ${column}`);
  return value;
}

/** One nullable text column of the row. */
function optionalText(
  row: PublicationLookupRow,
  column: string,
): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') refuse(`holds an unreadable ${column}`);
  return value;
}

/** One instant column of the row, as the ISO 8601 text that the domain reads. */
function instant(row: PublicationLookupRow, column: string): string {
  const value = row[column];
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    refuse(`holds an unreadable ${column}`);
  return value.toISOString();
}

/** One nullable instant column of the row. */
function optionalInstant(
  row: PublicationLookupRow,
  column: string,
): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    refuse(`holds an unreadable ${column}`);
  return value.toISOString();
}

/** One boolean column of the row. */
function flag(row: PublicationLookupRow, column: string): boolean {
  const value = row[column];
  if (typeof value !== 'boolean') refuse(`holds an unreadable ${column}`);
  return value;
}

/**
 * The scope of one stored link, which states exactly one of its two members.
 *
 * The reader path and the owner list both read a stored row, so both read the
 * scope here and one rule refuses a row that states both members or neither.
 */
export function storedScope(
  kind: string,
  fileId: string | null,
  path: string | null,
): PublicationScope {
  if (kind === 'note' && fileId !== null && path === null)
    return { kind: 'note', fileId };
  if (kind === 'folder' && path !== null && fileId === null)
    return { kind: 'folder', path };
  return refuse('states a scope that the domain does not declare');
}

/**
 * Reads one row of `notesapp_publication_by_token`.
 *
 * The bound of a folder link comes from `folderScopePrefix` of
 * `packages/core`, so the SQL of the repository and the scope rule of the
 * domain read one shape. A stored folder path that the path rules refuse has
 * no bound at all, and the parser refuses the row rather than answering a link
 * that no query can hold inside its folder.
 */
export function parsePublicationRow(
  row: PublicationLookupRow,
): StoredPublication {
  const scope = storedScope(
    text(row, 'scope_kind'),
    optionalText(row, 'scope_file_id'),
    optionalText(row, 'scope_path'),
  );
  const link: PublishedLink = {
    publicationId: text(row, 'publication_id'),
    workspaceId: text(row, 'workspace_id'),
    scope,
    createdAt: instant(row, 'created_at'),
    expiresAt: optionalInstant(row, 'expires_at'),
    revokedAt: optionalInstant(row, 'revoked_at'),
    passwordProtected: flag(row, 'password_protected'),
  };
  if (scope.kind === 'note')
    return {
      link,
      ownerAccountId: text(row, 'owner_account_id'),
      scopeFileId: scope.fileId,
      scopePrefix: null,
    };
  const prefix = folderScopePrefix(scope);
  if (prefix === null) return refuse('names a folder that has no path');
  return {
    link,
    ownerAccountId: text(row, 'owner_account_id'),
    scopeFileId: null,
    scopePrefix: prefix,
  };
}
