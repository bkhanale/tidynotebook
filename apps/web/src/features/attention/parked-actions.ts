/**
 * What Retry, Save as new note and Discard of Needs attention write.
 *
 * Each action drops the parked queue entry first. The entry, its checkpoints
 * and the local head they set go together, and every row of the device that
 * named one of those checkpoints moves to the revision below it (record
 * 0183), so the note returns to its accepted state before anything is
 * written on top of it. The kept copy goes last, after the action that
 * follows succeeded, so a failure never leaves the person with neither.
 *
 * The screen calls no network operation. Everything runs through the local
 * store, and the sync engine sends the save that an action queues.
 * `tests/integration/sync.test.ts` drives these functions against a server.
 */
import { generateUUID } from '@notesapp/core';
import type { Draft, LocalStore } from '@notesapp/sync';
import { storageNotePath } from '../../lib/note-name.ts';
import { recoveredNoteName, type ParkedSave } from '../../lib/parked-saves.ts';

/** The store, the account and the workspace that one action writes to. */
export type ParkedPlace = {
  readonly store: LocalStore;
  readonly accountId: string;
  readonly workspaceId: string;
};

/** Writes one text as a version on top of the accepted head it names. */
async function queueText(
  place: ParkedPlace,
  fileId: string,
  path: string,
  text: string,
): Promise<void> {
  const { store, accountId, workspaceId } = place;
  const files = await store.listAcceptedFiles(accountId, workspaceId);
  const accepted =
    files.find((file) => file.fileId === fileId)?.acceptedHeadRevisionId ??
    null;
  const draft: Draft = {
    accountId,
    workspaceId,
    workingCopyId: generateUUID(),
    fileId,
    baseRevisionId: accepted,
    text,
    path,
    deleted: false,
    sequence: 1,
  };
  await store.saveDraft(draft);
  // A kept text has no open document, so its text becomes the work.
  await store.checkpoint(draft, null, 'text');
  await store.dropDraft(accountId, workspaceId, draft.workingCopyId);
}

/** Drops the parked queue entry of one kept text. */
async function dropParked(place: ParkedPlace, save: ParkedSave): Promise<void> {
  if (save.mutationId === null) return;
  await place.store.discardQueueEntry(place.accountId, save.mutationId);
}

/** Removes the kept copy of one text. */
async function removeKept(place: ParkedPlace, save: ParkedSave): Promise<void> {
  await place.store.removeRecovery(
    place.accountId,
    place.workspaceId,
    save.recoveryId,
  );
}

/** Retry: the kept text becomes a new version of its note. */
export async function retryParked(
  place: ParkedPlace,
  save: ParkedSave,
): Promise<void> {
  await dropParked(place, save);
  await queueText(place, save.fileId, save.path, save.text);
  await removeKept(place, save);
}

/**
 * Save as new note: the kept text becomes a note of its own.
 *
 * The new name avoids every path that the server holds or may hold (record
 * 0184). The answer is that name.
 */
export async function keepParkedAsNote(
  place: ParkedPlace,
  save: ParkedSave,
): Promise<string> {
  const held = await place.store.listHeldPaths(
    place.accountId,
    place.workspaceId,
  );
  const name = recoveredNoteName(
    save.name,
    held.map((entry) => entry.path),
  );
  await dropParked(place, save);
  await queueText(place, generateUUID(), storageNotePath(name), save.text);
  await removeKept(place, save);
  return name;
}

/** Discard: the kept text leaves the device. */
export async function discardParked(
  place: ParkedPlace,
  save: ParkedSave,
): Promise<void> {
  await dropParked(place, save);
  await removeKept(place, save);
}
