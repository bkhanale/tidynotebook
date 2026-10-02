/**
 * Running a set of path rewrites, as data.
 *
 * Move to folder, the tree drag, and a rename in the tree all reach this function, so
 * the three of them write the same thing. The rewrite itself is one operation
 * of the local store: it gives every working copy of each note the new path in
 * one transaction, so no open editor can write the move back. See decision
 * record 0032.
 *
 * The rules that decide which notes move stay pure in `lib/folder-moves.ts`.
 * This module only runs the chosen moves and turns a failure into one sentence.
 */
import { isLocalStorageError, type LocalStore } from '@notesapp/sync';
import type { PathMove } from '../../lib/folder-moves.ts';
import { baseNameOf, displayNoteName } from '../../lib/note-name.ts';

/** The one sentence that states why a set of moves did not run. */
export function moveFailureMessage(
  moves: readonly PathMove[],
  failure: unknown,
): string {
  const first = moves[0];
  const subject =
    moves.length === 1 && first !== undefined
      ? displayNoteName(baseNameOf(first.toPath))
      : `${String(moves.length)} notes`;
  return isLocalStorageError(failure) && failure.kind === 'quota'
    ? `${subject} did not move. Free device space and try again.`
    : `${subject} did not move. Try again.`;
}

/**
 * Gives each named note its new path.
 *
 * Either every note moves or none does, so a folder rename never leaves half
 * of its notes behind. Returns `null` when the set moved, and one sentence
 * when it did not.
 */
export async function applyMoves(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  moves: readonly PathMove[],
): Promise<string | null> {
  if (moves.length === 0) return null;
  try {
    await store.moveFiles(accountId, workspaceId, moves);
    return null;
  } catch (failure: unknown) {
    return moveFailureMessage(moves, failure);
  }
}
