/**
 * The bounds of a workspace archive.
 *
 * Export writes the live files of a workspace as one zip archive, and import
 * reads such an archive back. Both read the bounds here, so an archive that
 * an export writes is always an archive that an import takes (issue 243).
 */

/**
 * The most files that one workspace archive holds.
 *
 * It is the bound of the zip format without its ZIP64 extension, which
 * counts the files of an archive in 16 bits. Export writes no more, and
 * import takes every archive up to it. An archive past it needs ZIP64, which
 * import does not read, so import refuses it by this bound and names it.
 */
export const maxArchiveEntries = 0xffff;

/**
 * The most bytes that the files of one imported archive hold together.
 *
 * An entry states its own size, and import refuses an archive whose stated
 * sizes pass this bound before it expands one entry. An entry that expands
 * past its stated size is refused as it expands, so a small archive cannot
 * fill the memory of the server.
 */
export const maxArchiveExpandedBytes = 100 * 1024 * 1024;

/** Whether one archive of `entries` files is inside the bound. */
export function archiveEntriesAllowed(entries: number): boolean {
  return (
    Number.isSafeInteger(entries) &&
    entries >= 0 &&
    entries <= maxArchiveEntries
  );
}
