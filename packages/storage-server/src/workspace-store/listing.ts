/**
 * The keyset paging of a file listing, shared by the live listing and the
 * trash listing.
 *
 * The two listings read the same `files` table with the same order and the
 * same cursor shape, so the cursor decode, the keyset bound, the order, and
 * the next-page cursor live here once.
 */
import { and, asc, desc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  OperationalError,
  decodeFileCursor,
  encodeFileCursor,
  type FileCursor,
  type FileSort,
} from '@notesapp/core';
import { files } from '../schema.ts';

/**
 * The position that a file listing continues from, or `null` for its front.
 *
 * A cursor that this server did not issue for this sort is a defect of the
 * caller: the transport validates the parameter before the use case runs, so
 * a value that reaches storage and does not parse is reported as such rather
 * than answered with the wrong rows.
 */
export function listingCursor(page: {
  readonly cursor: string | null;
  readonly sort: FileSort;
}): FileCursor | null {
  if (page.cursor === null) return null;
  const cursor = decodeFileCursor(page.cursor, page.sort);
  if (cursor === null) {
    throw new OperationalError(
      'unexpected',
      'notesapp: the page cursor does not belong to this listing; the transport must validate it.',
    );
  }
  return cursor;
}

/**
 * The rows of a listing that come after its cursor.
 *
 * The comparison is a keyset one on the whole order, sort key first and file
 * identifier second, so a page boundary that falls between two rows with the
 * same key neither repeats a row nor skips one.
 */
export function listingBound(cursor: FileCursor | null): SQL | undefined {
  if (cursor === null) return undefined;
  if (cursor.sort === 'path')
    return or(
      gt(files.path, cursor.key),
      and(eq(files.path, cursor.key), gt(files.id, cursor.fileId)),
    );
  // The bound is compared as a timestamp, not as a JavaScript instant: the
  // column keeps microseconds, and a value rounded to milliseconds would
  // match no row and would drop the whole rest of the listing.
  const instant = sql`${cursor.key}::timestamptz`;
  return or(
    lt(files.updatedAt, instant),
    and(eq(files.updatedAt, instant), lt(files.id, cursor.fileId)),
  );
}

/** The order of a file listing: newest change first, or path ascending. */
export function listingOrder(sort: FileSort): readonly SQL[] {
  return sort === 'path'
    ? [asc(files.path), asc(files.id)]
    : [desc(files.updatedAt), desc(files.id)];
}

/**
 * The exact acceptance instant of a row, in ISO 8601 with microseconds.
 *
 * The driver parses a timestamp into a JavaScript date, which holds only
 * milliseconds. A cursor built from that value would name an instant that no
 * row carries, so the key is read from the database as text instead.
 */
export const listingInstant = sql<string>`to_char(${files.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The cursor that continues a listing after its last returned row. */
export function nextListingCursor(
  sort: FileSort,
  last:
    | {
        readonly id: string;
        readonly path: string;
        readonly updatedKey: string;
      }
    | undefined,
): string | null {
  if (last === undefined) return null;
  return encodeFileCursor({
    sort,
    key: sort === 'path' ? last.path : last.updatedKey,
    fileId: last.id,
  });
}
