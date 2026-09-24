/**
 * What a new note is, as data.
 *
 * A new note is empty, because the one welcome note of an installation is
 * written by the server during setup. A daily note is the one exception: it
 * starts with the text of the template its member chose (record 0099). The
 * rules here stay pure, so the name choice and the starting text can be
 * tested without a browser and without a store.
 */
import type { Draft } from '@notesapp/sync';
import { joinNotePath } from './note-name.ts';

/** The identifiers that the caller draws for one new note. */
export type NewNoteIds = {
  readonly fileId: string;
  readonly workingCopyId: string;
};

/**
 * Picks a free name for a new note inside one folder.
 *
 * The person is not asked first: the note opens with its name field ready,
 * so a name is chosen by typing over this one.
 */
export function freeNotePath(
  takenPaths: readonly string[],
  folder: string,
): string {
  const taken = new Set(takenPaths.map((path) => path.toLowerCase()));
  const at = (name: string): string => joinNotePath(folder, name);
  if (!taken.has(at('New note.md').toLowerCase())) return at('New note.md');
  let index = 2;
  while (taken.has(at(`New note ${String(index)}.md`).toLowerCase()))
    index += 1;
  return at(`New note ${String(index)}.md`);
}

/**
 * The local draft of one new note.
 *
 * The text is empty unless the caller states one, which only a daily note
 * does, with the text of its template.
 */
export function newNoteDraft(input: {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly ids: NewNoteIds;
  readonly text?: string | undefined;
}): Draft {
  return {
    accountId: input.accountId,
    workspaceId: input.workspaceId,
    workingCopyId: input.ids.workingCopyId,
    fileId: input.ids.fileId,
    baseRevisionId: null,
    // A new note is empty. The welcome note of a first run is a server seed.
    text: input.text ?? '',
    path: input.path,
    deleted: false,
    sequence: 1,
  };
}
