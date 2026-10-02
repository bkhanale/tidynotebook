/**
 * What a move to Trash of rows of the tree moves (record 0164).
 *
 * A note row moves its note, and a folder row moves every note under it. A
 * selection can hold both, and a note inside a selected folder is one note,
 * so it is moved once. The folders matter as well: a folder is only a part of
 * a path, so the folder of a note that leaves stays on this device and the
 * tree still shows it, while a folder that a person moved to Trash leaves the
 * tree with its notes.
 *
 * The rule is pure, so `tree-trash.test.ts` states it.
 */
import { notesInFolder, type NoteSummary } from './note-list.ts';
import { displayNoteName, folderOf } from './note-name.ts';
import type { TreeTarget } from './tree-actions.ts';

/** One note that a move to Trash moves, with the name the bar reads. */
export type TrashItem = {
  readonly fileId: string;
  readonly name: string;
};

/** The notes and the folders of one move to Trash. */
export type TrashPlan = {
  readonly items: readonly TrashItem[];
  /** The folders whose notes leave and that the tree keeps on the device. */
  readonly keepFolders: readonly string[];
  /** The folders that a person moved to Trash, which leave the tree. */
  readonly dropFolders: readonly string[];
};

/** Whether a path lies inside one of the folders. */
function insideAny(path: string, folders: readonly string[]): boolean {
  const lower = path.toLowerCase();
  return folders.some((folder) => lower.startsWith(`${folder.toLowerCase()}/`));
}

/** The notes and the folders that a move to Trash of some rows moves. */
export function trashPlan(
  targets: readonly TreeTarget[],
  notes: readonly NoteSummary[],
): TrashPlan {
  const dropFolders = targets.flatMap((target) =>
    target.kind === 'folder' ? [target.path] : [],
  );
  const seen = new Set<string>();
  const items: TrashItem[] = [];
  const keep = new Set<string>();
  const add = (note: {
    readonly fileId: string;
    readonly path: string;
  }): void => {
    if (seen.has(note.fileId)) return;
    seen.add(note.fileId);
    items.push({ fileId: note.fileId, name: displayNoteName(note.path) });
  };
  for (const target of targets) {
    if (target.kind === 'folder') {
      for (const note of notesInFolder(notes, target.path)) add(note);
      continue;
    }
    add(target);
    const folder = folderOf(target.path);
    if (folder !== '' && !insideAny(target.path, dropFolders)) keep.add(folder);
  }
  return { items, keepFolders: [...keep], dropFolders };
}
