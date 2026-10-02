/**
 * Pure offline search over partition filtered local note content.
 *
 * This is the answer the device can give with no connection. It follows the
 * same two rules as the server: a note whose name matches comes before a note
 * that only matches in its text, and the excerpt is the part of the note that
 * matched, split into plain parts with every matched word marked. Like the
 * server index, it reads the readable text of each note that `readableText`
 * of the one grammar gives, so a word matches and shows as a reader sees it,
 * and both excerpts follow one plain text rule (records 0162, 0167).
 */
import { defaultSearchLimit } from '@notesapp/core';
import type { ExcerptPart, SearchHit } from '@notesapp/core';
import { MarkdownLimitError, readableText } from '@notesapp/markdown';

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

/** How many readable texts one cache keeps, the least recent going first. */
export const readableCacheSize = 10_000;

/**
 * How many notes one query reads that the cache does not hold.
 *
 * A read parses the note, on the main thread. A first query in a large
 * workspace would parse every note, so it reads this many and the queries
 * that follow read the rest, one bounded step at a time. A note that a query
 * did not reach yet is not in its answer; the server answers it online.
 */
export const maxParsesPerQuery = 256;

/** The most hits of one query, as the server answers at the most. */
export const localSearchLimit = defaultSearchLimit;

/**
 * The readable text of each note that the device read, by file and revision.
 *
 * An accepted revision never changes, and a draft keeps the revision it
 * leads from, so the key alone could name an older text of a draft. The
 * entry keeps the Markdown that it read, and a different Markdown is read
 * again. The cache is least recently used: a hit moves its entry to the end.
 */
export type ReadableCache = {
  /** How many notes this cache has parsed. */
  readonly parses: () => number;
  /** The cached readable text of a file, or `null` when it holds none. */
  readonly cached: (file: LocalSearchFile) => string | null;
  /** Parses one note and keeps its readable text. */
  readonly read: (file: LocalSearchFile) => string;
};

/** A new cache of readable texts. */
export function createReadableCache(
  capacity: number = readableCacheSize,
): ReadableCache {
  const entries = new Map<string, { source: string; text: string }>();
  let parses = 0;
  const keyOf = (file: LocalSearchFile): string =>
    `${file.fileId}\u0000${file.revisionId}`;
  return {
    parses: () => parses,
    cached: (file) => {
      const key = keyOf(file);
      const entry = entries.get(key);
      if (entry === undefined || entry.source !== file.text) return null;
      entries.delete(key);
      entries.set(key, entry);
      return entry.text;
    },
    read: (file) => {
      parses += 1;
      const title = noteTitle(file.path);
      let text: string;
      try {
        text = readableText(file.text, { title });
      } catch (failure) {
        // A text that the grammar refuses, by its size or its depth, is
        // searched as it is, so the device still finds it.
        if (!(failure instanceof MarkdownLimitError)) throw failure;
        text = file.text;
      }
      const key = keyOf(file);
      entries.delete(key);
      entries.set(key, { source: file.text, text });
      while (entries.size > capacity) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return text;
    },
  };
}

/** The cache of this device. */
const deviceCache = createReadableCache();

/**
 * Searches already partitioned local files without network access.
 *
 * If the input contains more than one state for a file, the last state wins.
 * The browser store places drafts after accepted states, so a current draft
 * replaces the downloaded accepted body for that file.
 *
 * Every word is matched in the readable text of a note, as the server index
 * holds it, so a word that the Markdown writes with an entity, an escape or a
 * mark inside it is found here as it is there. The notes are read in the
 * order of the answer, a note whose name matches first and then by path, and
 * the read stops at `localSearchLimit` hits. A note that the cache does not
 * hold costs a parse, and one query makes `maxParsesPerQuery` of them at the
 * most.
 */
export function searchLocal(
  query: string,
  files: readonly LocalSearchFile[],
  cache: ReadableCache = deviceCache,
): readonly SearchHit[] {
  const queryWords = words(query);
  if (queryWords.length === 0) return [];
  const latest = new Map<string, LocalSearchFile>();
  for (const file of files) latest.set(file.fileId, file);
  const ordered = [...latest.values()]
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
    );
  const hits: SearchHit[] = [];
  let parses = 0;
  for (const { file } of ordered) {
    if (hits.length >= localSearchLimit) break;
    let text = cache.cached(file);
    if (text === null) {
      if (parses >= maxParsesPerQuery) continue;
      parses += 1;
      text = cache.read(file);
    }
    const haystack = `${file.path}\n${text}`.toLocaleLowerCase('en-US');
    if (!queryWords.every((word) => haystack.includes(word))) continue;
    hits.push({
      fileId: file.fileId,
      path: file.path,
      revisionId: file.revisionId,
      excerpt: excerpt(text, queryWords),
    });
  }
  return hits;
}
