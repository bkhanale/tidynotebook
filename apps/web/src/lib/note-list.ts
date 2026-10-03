/**
 * The note list of the open area, as data.
 *
 * The functions here are pure, so the merge rule, the recency order, and
 * the shape of the folder tree are stated once and tested without a
 * browser. The provider in `files.tsx` is the only caller that reads them
 * from storage.
 */
import type { WorkspaceFileSummary } from '@notesapp/api-client';
import type { LocalFileSummary } from '@notesapp/sync';
import { mergeFileSummaries } from '../local-state.ts';
import {
  compareNames,
  compareNotes,
  defaultNoteOrder,
  type NoteOrder,
} from './note-order.ts';

/** One note of the open area, with the local facts the tree needs. */
export type NoteSummary = {
  readonly fileId: string;
  readonly path: string;
  /** The instant the note was made, which the date created order reads. */
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The note exists on this device only; the server has never seen it. */
  readonly localOnly: boolean;
  /** The device holds a save that the server has not accepted yet. */
  readonly unsent: boolean;
};

/**
 * Joins the accepted server list with the local drafts of this device.
 *
 * The result holds notes only. An attachment is a stored file of the same
 * workspace, but it is not a note: it has no editor and no name a person
 * chose, so it never reaches the tree, the note list, or the palette.
 */
export function mergeNotes(
  server: readonly WorkspaceFileSummary[],
  local: readonly LocalFileSummary[],
): readonly NoteSummary[] {
  const localById = new Map(local.map((file) => [file.fileId, file]));
  return mergeFileSummaries(server, local)
    .filter((file) => file.kind === 'note')
    .map((file) => {
      const own = localById.get(file.fileId);
      return {
        fileId: file.fileId,
        path: file.path,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        localOnly: own?.localOnly ?? false,
        unsent:
          own !== undefined &&
          own.localHeadRevisionId !== own.acceptedHeadRevisionId,
      };
    });
}

/** One name that a note holds, as a path with the note that holds it. */
export type NameInUse = {
  readonly fileId: string;
  readonly path: string;
};

/**
 * Every name that a new or a renamed note must avoid (record 0184).
 *
 * The listed notes name the path that each note shows. The held paths of the
 * store name what the server holds or may hold besides: the accepted path of
 * a note whose new name is unsent or parked, the path of each queued save,
 * and the path of each kept text. A note that renames itself skips its own
 * entries, because the server never refuses a note its own name.
 */
export function namesInUse(
  notes: readonly NameInUse[],
  held: readonly NameInUse[],
): readonly NameInUse[] {
  const seen = new Set<string>();
  const names: NameInUse[] = [];
  for (const entry of [...notes, ...held]) {
    const key = `${entry.fileId}\n${entry.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push({ fileId: entry.fileId, path: entry.path });
  }
  return names;
}

/** The most recently changed notes, newest first. */
export function recentNotes(
  notes: readonly NoteSummary[],
  limit: number,
): readonly NoteSummary[] {
  return [...notes]
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )
    .slice(0, limit);
}

/**
 * Every note whose path lies in the folder or in a folder below it.
 *
 * The prefix match is case-insensitive and includes the separator, so `Work`
 * matches `Work/Note.md` and never matches `Workshop/Note.md`. The input
 * order is kept.
 */
export function notesInFolder(
  notes: readonly NoteSummary[],
  folder: string,
): readonly NoteSummary[] {
  if (folder === '') return notes;
  const prefix = `${folder.toLowerCase()}/`;
  return notes.filter((note) => note.path.toLowerCase().startsWith(prefix));
}

/**
 * The folders that contain a note path, outermost first.
 *
 * A path `Work/Reports/Q1.md` lies in `Work` and in `Work/Reports`, so
 * opening that note must open both folders. A root note has no folder, so the
 * result is empty.
 */
export function ancestorFolders(path: string): readonly string[] {
  const segments = path.split('/').slice(0, -1);
  const folders: string[] = [];
  let prefix = '';
  for (const segment of segments) {
    if (segment === '') continue;
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    folders.push(prefix);
  }
  return folders;
}

/** One node of the rendered file tree. */
export type TreeNode =
  | {
      readonly kind: 'note';
      readonly note: NoteSummary;
      readonly basename: string;
    }
  | {
      readonly kind: 'folder';
      readonly name: string;
      readonly fullPath: string;
      readonly children: readonly TreeNode[];
    };

/**
 * Groups flat note paths into a folder tree, folders before notes.
 *
 * `emptyFolders` names the folders that a person made and that hold no note
 * yet. A folder is only a part of a note path, so nothing on the server
 * describes such a folder; this device remembers it and the tree shows it
 * with no children.
 *
 * `order` is the order that the person chose for the notes of each folder
 * (decision 0093). Folders have no date, so they always take the name order.
 */
export function buildNoteTree(
  notes: readonly NoteSummary[],
  emptyFolders: readonly string[] = [],
  order: NoteOrder = defaultNoteOrder,
): readonly TreeNode[] {
  type MutableFolder = {
    readonly folders: Map<string, MutableFolder>;
    readonly notes: Array<{
      readonly note: NoteSummary;
      readonly basename: string;
    }>;
  };
  const root: MutableFolder = { folders: new Map(), notes: [] };
  /** Walks to the folder of a path, making every missing level on the way. */
  const reach = (segments: readonly string[]): MutableFolder => {
    let current = root;
    for (const segment of segments) {
      if (segment === '') continue;
      let next = current.folders.get(segment);
      if (next === undefined) {
        next = { folders: new Map(), notes: [] };
        current.folders.set(segment, next);
      }
      current = next;
    }
    return current;
  };
  const ordered = [...notes].sort(compareNotes(order));
  for (const note of ordered) {
    const segments = note.path.split('/');
    const folder = reach(segments.slice(0, -1));
    folder.notes.push({ note, basename: segments.at(-1) ?? note.path });
  }
  for (const folder of emptyFolders) reach(folder.split('/'));
  const render = (
    folder: MutableFolder,
    prefix: string,
  ): readonly TreeNode[] => {
    const folders = [...folder.folders.entries()]
      .sort((a, b) => compareNames(a[0], b[0]))
      .map(([name, child]): TreeNode => {
        const fullPath = prefix === '' ? name : `${prefix}/${name}`;
        return {
          kind: 'folder',
          name,
          fullPath,
          children: render(child, fullPath),
        };
      });
    const leaves = folder.notes.map(({ note, basename }): TreeNode => ({
      kind: 'note',
      note,
      basename,
    }));
    return [...folders, ...leaves];
  };
  return render(root, '');
}
