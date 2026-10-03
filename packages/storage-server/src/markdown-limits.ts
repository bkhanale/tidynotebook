/**
 * The domain failure of a note that the Markdown package refuses.
 *
 * Storage reads the Markdown of an accepted revision to build the link index,
 * so a note above a limit of `@notesapp/markdown` reaches this layer as a
 * thrown `MarkdownLimitError`. It is an expected outcome of a valid request,
 * not an infrastructure failure, so it becomes a domain result with a message
 * for the author instead of a 500.
 *
 * The mapping lives here rather than in the core, because the core imports no
 * package and cannot name the error, and it is used twice: the workspace store
 * turns it into a `Result`, and the HTTP boundary uses it as the answer for a
 * path that has no `Result` of its own.
 */
import type { NoteRefusal } from '@notesapp/core';
import {
  MarkdownLimitError,
  type MarkdownLimitReason,
} from '@notesapp/markdown';

/** The domain code of each limit of the Markdown package. */
const refusals: Readonly<Record<MarkdownLimitReason, NoteRefusal>> = {
  'input-size': 'note_too_large',
  'nesting-depth': 'note_too_deep',
  'block-marks': 'note_too_many_marks',
  'table-cells': 'note_too_many_cells',
};

/** The domain code of a refused note, or null for any other value. */
export function markdownLimitCode(value: unknown): NoteRefusal | null {
  if (!(value instanceof MarkdownLimitError)) return null;
  return refusals[value.reason];
}
