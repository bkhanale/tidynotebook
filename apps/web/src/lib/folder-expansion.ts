/**
 * The one action that opens or closes every folder of the tree.
 *
 * The sidebar shows one toggle and not two buttons (decision 0093). It
 * collapses every folder while any folder of the tree is open, and it opens
 * every folder when none is. The rule reads the folders that the tree shows,
 * so an open folder that this device still remembers but that left the tree
 * cannot turn the toggle into a collapse that changes nothing on the screen.
 */

/** What the toggle does when a person selects it. */
export type FolderExpansion = 'expand' | 'collapse';

/** The name and the title of the toggle for each action. */
export const folderExpansionLabels: Readonly<Record<FolderExpansion, string>> =
  {
    expand: 'Expand all folders',
    collapse: 'Collapse all folders',
  };

/** Which action the toggle takes for the folders the tree shows now. */
export function folderExpansion(
  openFolders: ReadonlySet<string>,
  folders: readonly string[],
): FolderExpansion {
  return folders.some((folder) => openFolders.has(folder))
    ? 'collapse'
    : 'expand';
}

/** The open folders after the toggle runs one action. */
export function expandedFolders(
  action: FolderExpansion,
  folders: readonly string[],
): ReadonlySet<string> {
  return action === 'expand' ? new Set(folders) : new Set();
}
