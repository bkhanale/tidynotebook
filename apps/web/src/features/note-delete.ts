/**
 * Moving notes to the trash from the sidebar, as data.
 *
 * The note screen deletes one note by writing a tombstone checkpoint. The
 * sidebar offers the same action on a note row and, for a folder row, on
 * every note under the folder. Both call `deleteNotes` here, so one deletion
 * path writes the same tombstone for one note and for many.
 */
import { generateUUID } from '@notesapp/core';
import {
  isLocalStorageError,
  type Draft,
  type LocalStore,
} from '@notesapp/sync';
import { displayNoteName } from './note-name.ts';

/** One note that the sidebar asks to move to the trash. */
export type DeleteTarget = { readonly fileId: string; readonly name: string };

/** Whether every named note reached the trash, or why the run stopped. */
export type DeleteOutcome =
  | { readonly ok: true; readonly deleted: readonly string[] }
  | {
      readonly ok: false;
      readonly deleted: readonly string[];
      readonly message: string;
    };

/**
 * Moves each named note to the trash with one tombstone checkpoint.
 *
 * A note that this device does not hold cannot be deleted here, so the run
 * refuses it and names the note. A failure stops the run and names the note
 * that did not move. The caller asks the sync engine for a pass and announces
 * the undo notice.
 */
export async function deleteNotes(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  targets: readonly DeleteTarget[],
): Promise<DeleteOutcome> {
  const deleted: string[] = [];
  for (const target of targets) {
    const cached = await store.readCachedNote(
      accountId,
      workspaceId,
      target.fileId,
    );
    if (cached === null)
      return {
        ok: false,
        deleted: [...deleted],
        message: `${target.name} is not on this device yet. Open it, then delete it.`,
      };
    if (cached.deleted)
      return {
        ok: false,
        deleted: [...deleted],
        message: 'The note is already in Trash.',
      };
    const draft: Draft = {
      accountId,
      workspaceId,
      workingCopyId: cached.workingCopyId ?? generateUUID(),
      fileId: target.fileId,
      baseRevisionId: cached.baseRevisionId,
      text: cached.text,
      path: cached.path,
      deleted: true,
      sequence: cached.sequence + 1,
    };
    try {
      await store.saveDraft(draft);
      await store.checkpoint(draft, null);
    } catch (failure: unknown) {
      return {
        ok: false,
        deleted: [...deleted],
        message: isLocalStorageError(failure)
          ? `${displayNoteName(cached.path)} did not move to Trash. Free device space and try again.`
          : `${displayNoteName(cached.path)} did not move to Trash. Try again.`,
      };
    }
    deleted.push(target.fileId);
  }
  return { ok: true, deleted };
}
