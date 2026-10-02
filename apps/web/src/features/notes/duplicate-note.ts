/**
 * Duplicate: one note copied into a new note beside it.
 *
 * The note menu of the header copies the text of its open editor, and the
 * menu of a tree row copies the text that this device holds (record 0164).
 * Both make the copy here, through `createNote`, so a copy is a version when
 * it is made (record 0104) and takes the first free name `Plan copy`,
 * `Plan copy 2` and so on in the folder of the note.
 */
import { generateUUID } from '@notesapp/core';
import { createNote, type LocalStore } from '@notesapp/sync';
import { freeCopyPath, newNoteDraft } from '../../lib/new-note-draft.ts';
import { baseNameOf, displayNoteName, folderOf } from '../../lib/note-name.ts';

/** Makes the copy of one note and answers the identifier of the copy. */
export async function duplicateNote(
  store: LocalStore,
  input: {
    readonly accountId: string;
    readonly workspaceId: string;
    /** The path of the note that is copied. */
    readonly path: string;
    readonly text: string;
    /** The paths of the notes of the workspace, which the copy must not take. */
    readonly takenPaths: readonly string[];
  },
): Promise<string> {
  const fileId = generateUUID();
  await createNote(
    store,
    newNoteDraft({
      accountId: input.accountId,
      workspaceId: input.workspaceId,
      path: freeCopyPath(
        input.takenPaths,
        folderOf(input.path),
        displayNoteName(baseNameOf(input.path)),
      ),
      ids: { fileId, workingCopyId: generateUUID() },
      text: input.text,
    }),
  );
  return fileId;
}
