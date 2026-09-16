/**
 * The model of a published read-only link.
 *
 * A published link opens one note, or one folder and every note below it, for
 * a person who has no account. Decision 0030 states the record, and decision
 * 0031 states that the whole reader path is read only.
 *
 * Nothing here holds a secret. A record of this context carries no token, no
 * ticket, no password and no digest of one, so a value that reaches an answer
 * by mistake still opens nothing. The reader record also carries no owner,
 * because an answer of the reader path names no account.
 *
 * Every instant is an ISO 8601 string, as every other record of this package
 * states one. The rules compare instants in milliseconds since the Unix
 * epoch, and `instantMs` reads one. A text that is not an instant reads as
 * `null`, and every rule that receives `null` refuses. A rule therefore fails
 * closed on a stored value that it cannot read.
 */

/**
 * What one link opens.
 *
 * A note link names the identifier of the note, so a rename keeps the link. A
 * folder link names a path prefix, because a folder is a part of a note path
 * under decision 0005.
 */
export type PublicationScope =
  | { readonly kind: 'note'; readonly fileId: string }
  | { readonly kind: 'folder'; readonly path: string };

/**
 * One published link, as the owner list and the reader path both read it.
 *
 * `passwordProtected` states that a reader gives a password first. The digest
 * of that password is not a member of this record: the reader path never
 * needs it, so it stays in the storage layer and cannot reach an answer.
 */
export type PublishedLink = {
  readonly publicationId: string;
  readonly workspaceId: string;
  readonly scope: PublicationScope;
  readonly createdAt: string;
  /** Instant after which the link opens nothing, or `null` for no expiry. */
  readonly expiresAt: string | null;
  /** Instant at which the owner revoked the link, or `null`. */
  readonly revokedAt: string | null;
  readonly passwordProtected: boolean;
};

/**
 * One reading ticket, which the unlock answer gives to a reader.
 *
 * The ticket belongs to one link. Its expiry is stored, so a read never
 * computes a later one. `readingTicketExpiry` in `ticket.ts` states the one
 * rule that sets it.
 */
export type ReadingTicket = {
  readonly publicationId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
};

/** What the scope rule needs to know about one note. */
export type ScopedNote = {
  readonly fileId: string;
  readonly path: string;
  /** True for a note in the Trash, which no link opens. */
  readonly deleted: boolean;
};

/** One note that a link lists. */
export type PublishedNote = ScopedNote & {
  readonly headRevisionId: string;
  readonly updatedAt: string;
};

/**
 * One attachment reference of a note, and the revision it names now.
 *
 * The stored Markdown writes a reference in one of two forms: a portable path
 * under decision 0021, or a revision identifier of the first release. The
 * `reference` member repeats that written form, and `revisionId` states the
 * attachment revision that the form names at this instant.
 *
 * A reader surface needs both. It proves a request against `revisionId`, and
 * it builds the address of a picture from `reference`, because that is the
 * text that the renderer hands to its resolver.
 */
export type PublishedAttachmentReference = {
  /** The reference as the stored Markdown writes it. */
  readonly reference: string;
  /** The attachment revision that the reference names now. */
  readonly revisionId: string;
};

/** One note with the Markdown of its current head. */
export type PublishedNoteContent = PublishedNote & {
  readonly text: string;
};

/**
 * The largest number of links that one workspace holds.
 *
 * Decision 0030 states this bound. It is one named constant, as
 * `maxFilesPerChangeset` in `../files/commit.ts` is, so the server, the
 * screen and the contract read one value.
 */
export const maxPublishedLinksPerWorkspace = 200;

/**
 * Reads an instant as milliseconds since the Unix epoch.
 *
 * The answer is `null` when the text is not an instant. A caller treats
 * `null` as a refusal, never as the epoch, so an unreadable expiry stops a
 * link instead of opening it for ever.
 */
export function instantMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
