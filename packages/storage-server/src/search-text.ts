/**
 * The searchable text of one note (record 0167).
 *
 * The body of a row of `search_index` is the readable text of the note, and
 * `text_rule` names the version of the rule that made it. Every writer of a
 * row reads this module, so a row always states the rule it follows.
 */
import { indexNote, type NoteLink } from '@notesapp/markdown';

/**
 * The version of the rule that makes the body of a row.
 *
 * Raise it when `readableText` of `@notesapp/markdown` changes what it keeps.
 * `src/search-index-migration.ts` then makes every row of an earlier rule
 * again, before the server serves.
 */
export const searchTextRule = 1;

/** The name of a note as a person sees it: its last segment, no `.md`. */
export function noteTitle(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith('.md') ? name.slice(0, -'.md'.length) : name;
}

/**
 * The note links and the searchable text of one note, from one parse.
 *
 * It throws `MarkdownLimitError` for a note over the limits of the grammar,
 * so a note that the renderer refuses writes no row.
 */
export function searchableNote(
  text: string,
  path: string,
): { readonly links: readonly NoteLink[]; readonly body: string } {
  // The excerpt is shown under the name of the note, so a first block that
  // repeats the name is no part of the text (record 0162).
  const indexed = indexNote(text, path, { title: noteTitle(path) });
  return { links: indexed.links, body: indexed.text };
}
