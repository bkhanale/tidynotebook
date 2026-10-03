/**
 * The bounds of a workspace archive.
 *
 * Export writes the live files of a workspace as one zip archive, and import
 * reads such an archive back. Both read the bounds here, so an archive that
 * an export writes is always an archive that an import takes (issue 243).
 *
 * The bounds are the bounds of the zip format without its ZIP64 extension,
 * which counts files in 16 bits and bytes in 32 bits. Export refuses a
 * workspace past them before it sends a byte, and import takes every archive
 * up to them. Import keeps the archive in a file of the server and reads one
 * entry at a time, so the bounds hold the disk of the server, and the memory
 * of one import is one entry or one batch of notes, with the names of the
 * entries under `maxArchiveNameBytes`.
 */
import { maxSegmentBytes } from './path.ts';

/**
 * The most files that one workspace archive holds.
 *
 * The format counts files in 16 bits, and its largest count, 0xffff, is the
 * mark of an archive that states its count in ZIP64 instead. One less is the
 * largest count that means itself.
 */
export const maxArchiveEntries = 0xfffe;

/**
 * The most bytes of one workspace archive, and of the files that it holds
 * together.
 *
 * An export stores each file as it is, so the files of an archive that it
 * writes are never larger than the archive. An entry of another writer
 * states its own size, and import refuses an archive whose stated sizes pass
 * this bound before it expands one entry. An entry that expands past its
 * stated size is refused as it expands.
 */
export const maxArchiveBytes = 0xffff_ffff;

/** Whether one archive of `entries` files is inside the bound. */
export function archiveEntriesAllowed(entries: number): boolean {
  return (
    Number.isSafeInteger(entries) &&
    entries >= 0 &&
    entries <= maxArchiveEntries
  );
}

/** Whether `bytes` of an archive, or of its files, are inside the bound. */
export function archiveBytesAllowed(bytes: number): boolean {
  return Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= maxArchiveBytes;
}

/**
 * The most bytes of the names of the files of one archive, together.
 *
 * The reader of an import keeps the name of each file of an archive until it
 * has checked them all, and two imports can run at once (record 0170), so
 * the names need a bound of their own: the count and the length of each name
 * alone allow gigabytes.
 *
 * The bound is the full count of files, `maxArchiveEntries`, with the longest
 * name of one file, `maxSegmentBytes`, and one separator for each. A path of
 * a workspace is a few folders and a name of a few words, so an export of a
 * full workspace writes names far shorter than this on average, and an
 * archive of macOS, which stores names in NFD, stays under it too. An export
 * refuses a workspace whose paths pass it before the first byte, so every
 * archive that an export writes is one that an import takes.
 */
export const maxArchiveNameBytes = maxArchiveEntries * (maxSegmentBytes + 1);

/** Whether `bytes` of the names of the files of an archive are inside the bound. */
export function archiveNamesAllowed(bytes: number): boolean {
  return (
    Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= maxArchiveNameBytes
  );
}
