/**
 * The one set of resource bounds of a note document.
 *
 * Record 0082 asks for one set of bounds over wire bytes, decoded state,
 * structure, and recovery work. The text of a note has its own limit in
 * `packages/markdown`, which the server applies to the Markdown it derives,
 * so no text limit is stated here a second time.
 *
 * Record 0084 states that compaction cannot promise a fixed document size,
 * because it keeps every character identity. These bounds therefore refuse
 * work that is far above any note a person writes, and a refusal keeps the
 * work so that the caller can offer recovery.
 */

/** The bounds that every document operation reads. */
export type DocumentBounds = {
  /** Largest accepted update on the wire, in bytes. */
  readonly maxUpdateBytes: number;
  /** Most structures that one decoded update may hold. */
  readonly maxUpdateStructs: number;
  /** Largest encoded document after an update, in bytes. */
  readonly maxDocumentBytes: number;
  /** Most lines that one legacy recovery may compare. */
  readonly maxRecoveryLines: number;
  /** Most line edits that one legacy recovery diff may explore. */
  readonly maxRecoveryEdits: number;
};

/**
 * The bounds of this package.
 *
 * A note of one mebibyte, the Markdown limit, encodes to a document of about
 * the same size, and every later edit adds a few bytes of identity. Eight
 * times that leaves room for a long edit history of the largest note.
 */
export const documentBounds: DocumentBounds = {
  maxUpdateBytes: 2 * 1024 * 1024,
  maxUpdateStructs: 200_000,
  maxDocumentBytes: 8 * 1024 * 1024,
  maxRecoveryLines: 20_000,
  maxRecoveryEdits: 5_000,
};
