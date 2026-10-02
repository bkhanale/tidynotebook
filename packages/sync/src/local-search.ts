/**
 * Pure offline search over partition filtered local note content.
 *
 * This is the answer the device can give with no connection. It follows the
 * same two rules as the server: a note whose name matches comes before a note
 * that only matches in its text, and the excerpt is the part of the note that
 * matched, split into plain parts with every matched word marked. The window
 * is cut from the Markdown of the note, and `plainExcerpt` of the one grammar
 * turns it into the text a reader sees (record 0162).
 */
import type { ExcerptPart, SearchHit } from '@notesapp/core';
import { plainExcerpt } from '@notesapp/markdown';

/** One accepted or draft note that is safe to search in the active partition. */
export type LocalSearchFile = {
  readonly fileId: string;
  readonly path: string;
  readonly revisionId: string;
  readonly text: string;
};

/** How much text an excerpt shows, and how much of it sits before the match. */
const excerptLength = 240;
const excerptLead = 60;

/** Normalized words that all need to occur in a local result. */
function words(query: string): readonly string[] {
  return query
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** The name of a note as a person sees it, without the `.md` suffix. */
function noteTitle(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith('.md') ? name.slice(0, -'.md'.length) : name;
}

/** The ranges of `folded` that hold one of the words, merged and in order. */
function matchRanges(
  folded: string,
  queryWords: readonly string[],
): readonly (readonly [number, number])[] {
  const found: [number, number][] = [];
  for (const word of queryWords) {
    let at = folded.indexOf(word);
    while (at >= 0) {
      found.push([at, at + word.length]);
      at = folded.indexOf(word, at + word.length);
    }
  }
  found.sort((left, right) => left[0] - right[0]);
  const merged: [number, number][] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last !== undefined && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else merged.push([...range]);
  }
  return merged;
}

/** A bounded excerpt around the first match, with every match marked. */
function excerpt(
  text: string,
  queryWords: readonly string[],
): readonly ExcerptPart[] {
  const folded = text.toLocaleLowerCase('en-US');
  const first = matchRanges(folded, queryWords)[0]?.[0];
  const start = first === undefined ? 0 : Math.max(0, first - excerptLead);
  const end = Math.min(text.length, start + excerptLength);
  const window = text.slice(start, end);
  const parts: ExcerptPart[] = [];
  if (start > 0) parts.push({ text: '...', marked: false });
  let at = 0;
  for (const [from, to] of matchRanges(folded.slice(start, end), queryWords)) {
    if (from > at) parts.push({ text: window.slice(at, from), marked: false });
    parts.push({ text: window.slice(from, to), marked: true });
    at = to;
  }
  if (at < window.length) parts.push({ text: window.slice(at), marked: false });
  if (end < text.length) parts.push({ text: '...', marked: false });
  return parts;
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
    .map((file) => {
      const title = noteTitle(file.path).toLocaleLowerCase('en-US');
      return { file, named: queryWords.some((word) => title.includes(word)) };
    })
    .sort((left, right) =>
      left.named !== right.named
        ? Number(right.named) - Number(left.named)
        : left.file.path < right.file.path
          ? -1
          : 1,
    )
    .map(({ file }) => ({
      fileId: file.fileId,
      path: file.path,
      revisionId: file.revisionId,
      excerpt: plainExcerpt(excerpt(file.text, queryWords), {
        title: noteTitle(file.path),
      }),
    }));
}
