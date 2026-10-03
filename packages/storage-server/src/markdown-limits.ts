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
import type { DomainErrorCode } from '@notesapp/core';
import { MarkdownLimitError } from '@notesapp/markdown';

/** The domain codes of a note that the Markdown package refuses. */
export type MarkdownRefusalCode = Extract<
  DomainErrorCode,
  'note_too_large' | 'note_too_deep'
>;

/** The domain code of a refused note, or null for any other value. */
export function markdownLimitCode(value: unknown): MarkdownRefusalCode | null {
  if (!(value instanceof MarkdownLimitError)) return null;
  return value.reason === 'input-size' ? 'note_too_large' : 'note_too_deep';
}
