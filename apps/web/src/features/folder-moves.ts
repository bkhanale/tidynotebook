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
  displayNoteName,
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
