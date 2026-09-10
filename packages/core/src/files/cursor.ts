/**
 * The opaque cursor of a file listing.
 *
 * A listing is ordered by a sort key and, when two rows carry the same key, by
 * the file identifier. Both parts therefore belong in the cursor: the next
 * page starts at the first row after that exact pair, so a page boundary never
 * repeats a row and never skips one. A cursor that names the file identifier
 * alone can only continue an order by that identifier.
 *
 * The text is safe in a query string and holds no secret: it addresses rows of
 * a workspace that the caller may already list. It is not signed. A value that
 * does not parse is refused, because a wrong bound would skip rows in silence.
 */
import type { FileSort } from './ports.ts';

/** The position of the last row of a page. */
export type FileCursor = {
  readonly sort: FileSort;
  /** The sort key of that row: an instant for `updated`, a path for `path`. */
  readonly key: string;
  readonly fileId: string;
};

/** The shape of the file identifier inside a cursor. */
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * The cursor that continues a listing after this row.
 *
 * The sort name and the file identifier come first, because neither of them
 * holds a full stop. The sort key comes last and is percent encoded, so it
 * survives a query string with every character it holds, including the spaces
 * of a path.
 */
export function encodeFileCursor(cursor: FileCursor): string {
  return `${cursor.sort}.${cursor.fileId}.${encodeURIComponent(cursor.key)}`;
}

/**
 * The position that a cursor names, or `null` when it names none.
 *
 * A cursor of another sort is refused as well: its key would be compared
 * against a different column, which would skip or repeat rows.
 */
export function decodeFileCursor(
  value: string,
  sort: FileSort,
): FileCursor | null {
  const first = value.indexOf('.');
  if (first === -1) return null;
  const second = value.indexOf('.', first + 1);
  if (second === -1) return null;
  const fileId = value.slice(first + 1, second);
  if (value.slice(0, first) !== sort || !uuid.test(fileId)) return null;
  let key: string;
  try {
    key = decodeURIComponent(value.slice(second + 1));
  } catch {
    return null;
  }
  if (sort === 'updated' && Number.isNaN(Date.parse(key))) return null;
  return { sort, key, fileId };
}
