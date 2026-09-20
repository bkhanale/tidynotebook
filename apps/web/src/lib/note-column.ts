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
 * The rules live here, outside JSX, so a unit test can read them.
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

/**
 * The classes of the frame that holds the note text and the note footer.
 *
 * The frame draws no space above the text. The editor scrolls inside it, so
 * any padding here stays on the screen under the frame header while the text
 * moves behind it, and a person reads that strip as a second bar that says
 * nothing. The space above the first line belongs to `.cm-content` in
 * `packages/editor/src/editor-theme.ts`, where it scrolls with the text and a
 * click in it still places the caret.
 */
export function noteFrameClassName(): string {
  return 'flex min-h-0 min-w-0 flex-1 flex-col';
}

/**
 * The classes of the footer row under the note text.
 *
 * The footer draws `edge-line` above itself. The note text is a region a
 * person scrolls, and the design guide draws a divider exactly there, so the
 * line states where the text stops and the count of the note starts. Without
 * it the sentence reads as one more line of the note.
 */
export function noteFooterClassName(): string {
  return 'shrink-0 border-t border-edge-line px-2 py-2 text-control text-muted';
}
