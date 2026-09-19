/**
 * The column that the note text and the note footer share.
 *
 * The name of the note is not here: it is the last part of the breadcrumb in
 * the frame header (decision 0069), so the note surface starts with the text.
 * The text and the footer stay one centred column of the note measure, and
 * the editor centres its own lines on the same measure in
 * `packages/editor/src/editor-theme.ts`. See
 * [decision 0055](../../../../docs/decisions/0055-the-note-is-one-centred-column.md).
 *
 * The rule lives here, outside JSX, so a unit test can read it.
 */

/**
 * The classes of the column that the text and the footer share.
 *
 * One measure, centred in the space the note screen owns. A frame that cannot
 * reach the editor adapter reads this constant, the way every page frame reads
 * `pageGutter` from `@notesapp/ui`.
 */
export function noteColumnClassName(): string {
  return 'mx-auto flex w-full max-w-note flex-col gap-1';
}
