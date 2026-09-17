/**
 * The layout of the note header row.
 *
 * The note name is the largest type on the screen and the header carries it
 * alone: the note saves itself and every note action lives in the command
 * palette. The rule lives here so a unit test can hold it: the name takes the
 * full width of the column at every size, so the most important text on the
 * screen is never cut.
 *
 * The name and the text of the note are one block, so the space under the
 * name stays small. The space above it keeps the row clear of the frame.
 *
 * The name, the text and the footer are one centred column of the note
 * measure. `noteColumnClassName` is that column, and the editor centres its
 * own lines on the same measure in `packages/editor/src/editor-theme.ts`. See
 * [decision 0052](../../../../docs/decisions/0052-the-note-is-one-centred-column.md).
 */
import { transitionSurface } from '@notesapp/ui';

/**
 * The classes of the sticky header row.
 *
 * The bottom space is smaller than the top space on purpose: the name titles
 * the text under it, so the two group together and the note reads as one
 * page. The editor column and the note surface add the rest of the space, so
 * this row keeps its own part of it short.
 *
 * The inline padding matches the inline padding of the editor content, so the
 * column inside this row lands on the same measure as the text.
 */
export function noteHeaderRowClassName(): string {
  return 'sticky top-0 z-20 flex shrink-0 flex-col border-b border-edge-line bg-app px-2 pb-1.5 pt-3';
}

/**
 * The classes of the column that the name, the text and the footer share.
 *
 * One measure, centred in the space the note screen owns. A frame that cannot
 * reach the editor adapter reads this constant, the way every page frame reads
 * `pageGutter` from `@notesapp/ui`.
 */
export function noteColumnClassName(): string {
  return 'mx-auto flex w-full max-w-note flex-col gap-1';
}

/**
 * The classes of the inline editable note name.
 *
 * The name is a title, not a form field. At rest it carries no box and no
 * border, so the screen opens on the note and not on a control. A quiet
 * underline appears under the pointer and the accent underline marks
 * keyboard focus. The transparent underline is always there, so the text
 * never moves when a state changes.
 *
 * It is the largest text on the note screen, which is what decision 0015
 * states, so it sits one step above the top of the note heading ramp in
 * `apps/web/src/tailwind.css`.
 */
export function noteTitleClassName(): string {
  return `block w-full min-w-0 border-0 border-b-2 border-transparent bg-transparent py-1 text-3xl font-semibold tracking-display text-strong outline-none ${transitionSurface} hover:border-edge-line focus:border-focus`;
}
