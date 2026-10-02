/**
 * The bounded read of the file list of one notes area.
 *
 * The server answers one page at a time, so a screen that wants the whole
 * list asks page after page. A workspace can hold more notes than a screen
 * can show, so the loop needs a stop. `loadBoundedFiles` collects pages until
 * it holds the bound, and then it stops and says that it stopped. The bound
 * arrives as an argument, and `loadNoteList` passes `maxNoteListFiles` of
 * `@notesapp/core`, the one value that the server and this device share.
 *
 * The module knows nothing about the transport and nothing about React. It
 * calls the page reader that it is given, which is a generated operation in
 * the application and a small fake in the test.
 */
import { maxNoteListFiles, maxPageSize } from '@notesapp/core';

/**
 * The number of rows that one list call of the area asks for.
 *
 * The largest page that the server serves, so the list of a workspace of
 * 1000 notes arrives in two calls. Each call costs a round trip and a
 * transaction, and a page of 100 made it ten calls one after the other
 * (issue 264). `maxNoteListFiles` is the one bound of the whole list.
 */
export const fileListPageSize = maxPageSize;

/** One page of a file listing, whatever the row type is. */
export type FilePageResult<Row> = {
  readonly files: readonly Row[];
  /** The cursor of the next page, or `null` after the last page. */
  readonly nextCursor: string | null;
};

/** Reads one page, from the start when the cursor is `null`. */
export type ReadFilePage<Row> = (
  cursor: string | null,
) => Promise<FilePageResult<Row>>;

/** What one bounded load collected. */
export type BoundedFiles<Row> = {
  readonly files: readonly Row[];
  /** `true` when the load stopped at the bound and more rows remain. */
  readonly reachedLimit: boolean;
};

/**
 * Every file of the area, up to the bound.
 *
 * The loop stops for three reasons: the last page arrived, the bound is full,
 * or a page carried no row. The last one keeps the loop safe when a page
 * offers a cursor but no progress.
 */
export async function loadBoundedFiles<Row>(
  readPage: ReadFilePage<Row>,
  limit: number,
): Promise<BoundedFiles<Row>> {
  const files: Row[] = [];
  const bound = Math.max(0, Math.trunc(limit));
  if (bound === 0) return { files, reachedLimit: false };
  let cursor: string | null = null;
  for (;;) {
    const page = await readPage(cursor);
    files.push(...page.files);
    if (files.length >= bound)
      return {
        files: files.slice(0, bound),
        reachedLimit: files.length > bound || page.nextCursor !== null,
      };
    if (page.nextCursor === null) return { files, reachedLimit: false };
    if (page.files.length === 0) return { files, reachedLimit: true };
    cursor = page.nextCursor;
  }
}

/**
 * Every file of a notes area, page after page (record 0165).
 *
 * The tree and All notes render a window of their rows, so the list reads
 * every page up to `maxNoteListFiles` of `@notesapp/core`, which only stops a
 * server that never ends its pages. It stopped at `maxListedFiles`, and a
 * workspace of 1010 notes showed 1000 of them (issue 256).
 */
export function loadNoteList<Row>(
  readPage: ReadFilePage<Row>,
): Promise<BoundedFiles<Row>> {
  return loadBoundedFiles(readPage, maxNoteListFiles);
}

/** A count and its word, for example `1 note` and `3 notes`. */
export function notePhrase(count: number): string {
  return count === 1 ? '1 note' : `${String(count)} notes`;
}

/**
 * What the person reads when the list is shorter than the area.
 *
 * The answer is `null` while the list holds every note, because there is then
 * nothing to say. When the load stopped at the bound, the message states the
 * size of the list and the one action that opens the other notes.
 */
export function fileListLimitNotice(
  loaded: number,
  reachedLimit: boolean,
): string | null {
  if (!reachedLimit) return null;
  return `The list shows the first ${notePhrase(loaded)}. Use search to open a note that is not in the list.`;
}
