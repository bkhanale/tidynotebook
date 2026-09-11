/**
 * Folder moves as data.
 *
 * A folder is not a stored object: it exists because notes carry a path
 * with a separator in it. Every folder action is therefore a rewrite of
 * note paths through the same rename path a person uses in the note name,
 * so a move, a rename, and a hand typed name follow one rule and produce
 * one history. Nothing is written until every new path is free.
 *
 * This module stays pure so the rules can be tested without a browser and
 * without a built storage package. `folders.tsx` performs the writes.
 */
import type { NoteSummary } from './note-list.ts';
import {
  baseNameOf,
  displayNoteName,
  joinNotePath,
  noteNameProblem,
  rewriteFolder,
} from './note-name.ts';

/** One note that moves, with the path it moves to. */
export type PathMove = {
  readonly fileId: string;
  readonly toPath: string;
};

/**
 * States why a set of moves cannot run, or `null` when it can.
 *
 * The check runs before the first write, so a folder rename never leaves
 * half of its notes moved.
 */
export function moveProblem(
  moves: readonly PathMove[],
  notes: readonly NoteSummary[],
): string | null {
  if (moves.length === 0) return 'Nothing moves with that name.';
  const moving = new Set(moves.map((move) => move.fileId));
  const taken = new Set(
    notes
      .filter((note) => !moving.has(note.fileId))
      .map((note) => note.path.toLowerCase()),
  );
  for (const move of moves) {
    const problem = noteNameProblem(displayNoteName(move.toPath));
    if (problem !== null) return problem;
    if (taken.has(move.toPath.toLowerCase()))
      return `A note named ${displayNoteName(move.toPath)} already exists there. Choose a different name.`;
  }
  return null;
}

/** The moves that a folder rename or a folder move implies. */
export function folderMoves(
  notes: readonly NoteSummary[],
  fromFolder: string,
  toFolder: string,
): readonly PathMove[] {
  const moves: PathMove[] = [];
  for (const note of notes) {
    const toPath = rewriteFolder(note.path, fromFolder, toFolder);
    if (toPath === null || toPath === note.path) continue;
    moves.push({ fileId: note.fileId, toPath });
  }
  return moves;
}

/** What the pointer carries while a row of the tree is dragged. */
export type DragItem =
  | {
      readonly kind: 'note';
      readonly fileId: string;
      readonly path: string;
    }
  | {
      readonly kind: 'folder';
      readonly folder: string;
    };

/** What a drop does, once it is known to be possible. */
export type DropPlan = {
  /** The notes that change path. A folder with no note in it moves none. */
  readonly moves: readonly PathMove[];
  /** The folder rewrite a folder drop implies, or `null` for a note drop. */
  readonly folderMove: {
    readonly from: string;
    readonly to: string;
  } | null;
};

/** The outcome of a drop: a plan, nothing to do, or one stated refusal. */
export type DropOutcome = {
  /** `null` when the drop changes nothing, for example a drop in place. */
  readonly plan: DropPlan | null;
  /** The one sentence that states why the drop cannot run. */
  readonly problem: string | null;
};

/** The last segment of a folder path. */
function folderName(folder: string): string {
  return folder.split('/').at(-1) ?? folder;
}

/** Whether `inner` is the folder `outer` itself or a folder inside it. */
function isInside(inner: string, outer: string): boolean {
  return inner === outer || inner.startsWith(`${outer}/`);
}

/**
 * States what a drop on one folder row does, or why it is refused.
 *
 * The target folder is a stored folder path, and the empty string is the
 * "All notes" root. The rules are the same as the Move to dialog, so the
 * pointer path and the keyboard path cannot disagree: nothing is written
 * unless every new path is free.
 */
export function planDrop(
  item: DragItem,
  toFolder: string,
  notes: readonly NoteSummary[],
  emptyFolders: readonly string[] = [],
): DropOutcome {
  if (item.kind === 'note') {
    const toPath = joinNotePath(toFolder, baseNameOf(item.path));
    if (toPath === item.path) return { plan: null, problem: null };
    const moves: readonly PathMove[] = [{ fileId: item.fileId, toPath }];
    const problem = moveProblem(moves, notes);
    if (problem !== null) return { plan: null, problem };
    return { plan: { moves, folderMove: null }, problem: null };
  }

  if (item.folder === '')
    return { plan: null, problem: 'There is no folder to move.' };
  if (isInside(toFolder, item.folder))
    return {
      plan: null,
      problem: 'A folder cannot move into itself. Choose another folder.',
    };
  const toName = folderName(item.folder);
  const target = joinNotePath(toFolder, toName);
  if (target === item.folder) return { plan: null, problem: null };
  const occupied =
    emptyFolders.includes(target) ||
    notes.some((note) =>
      note.path.toLowerCase().startsWith(`${target.toLowerCase()}/`),
    );
  if (occupied)
    return {
      plan: null,
      problem: `A folder named ${toName} already exists there. Choose a different name.`,
    };
  const moves = folderMoves(notes, item.folder, target);
  if (moves.length > 0) {
    const problem = moveProblem(moves, notes);
    if (problem !== null) return { plan: null, problem };
  }
  return {
    plan: { moves, folderMove: { from: item.folder, to: target } },
    problem: null,
  };
}
