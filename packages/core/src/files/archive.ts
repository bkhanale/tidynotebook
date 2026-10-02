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
 * of one import is one entry or one batch of notes.
 */

/** The most files that one workspace archive holds. */
export const maxArchiveEntries = 0xffff;

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
