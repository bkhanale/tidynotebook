/** Pure rules for the folder that receives a new item. */

import { folderPaths, joinNotePath } from './note-name.ts';

/** Every folder that a note or an empty folder makes visible in the tree. */
export function knownFolderPaths(
  notePaths: readonly string[],
  emptyFolders: readonly string[],
): readonly string[] {
  const emptyFolderLeaves = emptyFolders.map((folder) =>
    joinNotePath(folder, 'empty.md'),
  );
  return folderPaths([...notePaths, ...emptyFolderLeaves]);
}

/** Keeps a selected folder only while the tree still contains it. */
export function selectedFolderOrRoot(
  selected: string,
  folders: readonly string[],
): string {
  return selected === '' || folders.includes(selected) ? selected : '';
}

/** Joins one direct child name to its selected parent. */
export function childFolderPath(parent: string, child: string): string {
  return joinNotePath(parent, child);
}
