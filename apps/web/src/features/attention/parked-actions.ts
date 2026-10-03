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
import type { CheckpointSource, Draft, LocalStore } from '@notesapp/sync';
import { storageNotePath } from '../../lib/note-name.ts';
import { recoveredNoteName, type ParkedSave } from '../../lib/parked-saves.ts';

/** The store, the account and the workspace that one action writes to. */
export type ParkedPlace = {
  readonly store: LocalStore;
  readonly accountId: string;
  readonly workspaceId: string;
};

/**
 * Writes one version on top of the accepted head that the device knows.
 *
 * `text` writes the text as the work of the version. A `document` source
 * saves the document of the note as it stands (record 0133).
 */
async function queueVersion(
  place: ParkedPlace,
  fileId: string,
  path: string,
  text: string,
  source: CheckpointSource,
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
  await store.checkpoint(draft, null, source);
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

/**
 * Retry: the work of the parked save goes to the server again.
 *
 * The document of the note holds that work when it observed the save. The
 * retry then saves the document as it stands, which carries the work of the
 * parked save and of every later save of the note (record 0085). A kept text
 * written over it would remove the words of each later parked save of the
 * note, which an earlier release left as rows of their own, and the save
 * that removed them would end those rows (record 0183). A document that
 * lacks the work, such as one of a new generation, takes the kept text.
 */
export async function retryParked(
  place: ParkedPlace,
  save: ParkedSave,
): Promise<void> {
  const epoch =
    save.mutationId === null
      ? null
      : await place.store.parkedWorkHeld(
          place.accountId,
          place.workspaceId,
          save.mutationId,
          save.fileId,
        );
  await dropParked(place, save);
  await queueVersion(
    place,
    save.fileId,
    save.path,
    save.text,
    epoch === null ? 'text' : { kind: 'document', epoch },
  );
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
  // A new note has no document yet, so the kept text becomes its work.
  await queueVersion(
    place,
    generateUUID(),
    storageNotePath(name),
    save.text,
    'text',
  );
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
