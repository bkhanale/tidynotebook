/** Pure offline search over partition filtered local note content. */
import type { SearchHit } from '@notesapp/core';

/** One accepted or draft note that is safe to search in the active partition. */
export type LocalSearchFile = {
  readonly fileId: string;
  readonly path: string;
  readonly revisionId: string;
  readonly text: string;
};

/** Normalized words that all need to occur in a local result. */
function words(query: string): readonly string[] {
  return query
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** A bounded excerpt around the first matched word. */
function excerpt(text: string, queryWords: readonly string[]): string {
  const folded = text.toLocaleLowerCase('en-US');
  const first = queryWords
    .map((word) => folded.indexOf(word))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const start = first === undefined ? 0 : Math.max(0, first - 60);
  const end = Math.min(text.length, start + 240);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
}

/**
 * Searches already partitioned local files without network access.
 *
 * If the input contains more than one state for a file, the last state wins.
 * The browser store places drafts after accepted states, so a current draft
 * replaces the downloaded accepted body for that file.
 */
export function searchLocal(
  query: string,
  files: readonly LocalSearchFile[],
): readonly SearchHit[] {
  const queryWords = words(query);
  if (queryWords.length === 0) return [];
  const latest = new Map<string, LocalSearchFile>();
  for (const file of files) latest.set(file.fileId, file);
  return [...latest.values()]
    .filter((file) => {
      const haystack = `${file.path}\n${file.text}`.toLocaleLowerCase('en-US');
      return queryWords.every((word) => haystack.includes(word));
    })
    .sort((left, right) => (left.path < right.path ? -1 : 1))
    .map((file) => ({
      fileId: file.fileId,
      path: file.path,
      revisionId: file.revisionId,
      excerpt: excerpt(file.text, queryWords),
    }));
}
