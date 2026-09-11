/**
 * Folders that hold no note, as data.
 *
 * A folder is not a stored object: it exists because notes carry a path with
 * a separator in it. A folder that a person just made therefore holds
 * nothing, and the server cannot remember it. This device remembers it
 * instead, next to the open folders of the tree, until a note is made or
 * moved into it. No placeholder note is created.
 *
 * The rules stay pure so they can be tested without a browser. `files.tsx`
 * performs the reads and the writes.
 */

/** Whether any note path lies inside the named folder. */
function holdsNote(folder: string, notePaths: readonly string[]): boolean {
  const prefix = `${folder}/`.toLowerCase();
  return notePaths.some((path) => path.toLowerCase().startsWith(prefix));
}

/** Sorts folder paths and removes repeats, so the tree order is stable. */
function tidy(folders: readonly string[]): readonly string[] {
  return [...new Set(folders.filter((folder) => folder !== ''))].sort(
    (left, right) => (left < right ? -1 : 1),
  );
}

/**
 * The remembered folders that still hold nothing.
 *
 * A folder drops out of the set as soon as a note lives in it, because the
 * note paths then describe it and the tree shows it without help.
 */
export function pruneEmptyFolders(
  remembered: readonly string[],
  notePaths: readonly string[],
): readonly string[] {
  return tidy(remembered).filter((folder) => !holdsNote(folder, notePaths));
}

/** The set with one more folder in it. */
export function withEmptyFolder(
  remembered: readonly string[],
  folder: string,
): readonly string[] {
  return tidy([...remembered, folder]);
}

/**
 * The set after a folder moved or was renamed.
 *
 * The folder itself and every remembered folder inside it follow the move, so
 * an empty folder that a person dragged keeps its place in the tree.
 */
export function rewriteEmptyFolders(
  remembered: readonly string[],
  fromFolder: string,
  toFolder: string,
): readonly string[] {
  if (fromFolder === '') return tidy(remembered);
  const prefix = `${fromFolder}/`;
  return tidy(
    remembered.map((folder) => {
      if (folder === fromFolder) return toFolder;
      if (folder.startsWith(prefix))
        return toFolder === ''
          ? folder.slice(prefix.length)
          : `${toFolder}/${folder.slice(prefix.length)}`;
      return folder;
    }),
  );
}
