/**
 * Moving notes to the trash, as data.
 *
 * The note screen, the sidebar note row, and the sidebar folder row all reach
 * this function, so one deletion path writes the same tombstone for one note
 * and for many. The write itself is one operation of the local store: it marks
 * every working copy of each note deleted in one transaction, so no open editor
 * can bring the note back with its next save. See decision record 0032.
 */
import { isLocalStorageError, type LocalStore } from '@notesapp/sync';

/** One note that a screen asks to move to the trash. */
export type DeleteTarget = { readonly fileId: string; readonly name: string };

/** Whether every named note reached the trash, or why the run stopped. */
export type DeleteOutcome =
  | { readonly ok: true; readonly deleted: readonly string[] }
  | {
      readonly ok: false;
      readonly deleted: readonly string[];
      readonly message: string;
    };

/** The one sentence that states why a set of deletions did not run. */
export function deleteFailureMessage(
  targets: readonly DeleteTarget[],
  failure: unknown,
): string {
  const first = targets[0];
  const subject =
    targets.length === 1 && first !== undefined
      ? first.name
      : `${String(targets.length)} notes`;
  return isLocalStorageError(failure) && failure.kind === 'quota'
    ? `${subject} did not move to Trash. Free device space and try again.`
    : `${subject} did not move to Trash. Try again.`;
}

/**
 * Moves each named note to the trash with one tombstone per note.
 *
 * Either every note reaches the trash or none does, so a folder deletion never
 * leaves half of its notes behind. A note that is already in the trash is
 * skipped, and it still counts as deleted for the caller.
 */
export async function deleteNotes(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  targets: readonly DeleteTarget[],
): Promise<DeleteOutcome> {
  if (targets.length === 0) return { ok: true, deleted: [] };
  try {
    await store.trashFiles(
      accountId,
      workspaceId,
      targets.map((target) => target.fileId),
    );
    return { ok: true, deleted: targets.map((target) => target.fileId) };
  } catch (failure: unknown) {
    return {
      ok: false,
      deleted: [],
      message: deleteFailureMessage(targets, failure),
    };
  }
}
