/**
 * The save state of one note and the state of its Save button.
 *
 * `resolveSaveState` reads durable facts about one file only.
 * `resolveSaveButton` turns those facts into the one state the Save button
 * of the note header shows, so the person reads the result of a save on the
 * control they pressed.
 */
import type { LocalStorageErrorKind, QueueState } from '@notesapp/sync';

export type SaveState =
  | 'saving-local'
  | 'saved-local'
  | 'syncing'
  | 'saved-server'
  | 'storage-full'
  | 'save-failed';

export type SaveStateInput = {
  readonly draftWritePending: boolean;
  readonly queueState: QueueState | null;
  readonly storageError: LocalStorageErrorKind | null;
  readonly hasUncheckpointedDraft: boolean;
  readonly acceptedHeadRevisionId: string | null;
  readonly localHeadRevisionId: string | null;
};

/** Selects a label from durable facts about one file only. */
export function resolveSaveState(input: SaveStateInput): SaveState {
  if (input.storageError === 'quota') return 'storage-full';
  if (input.storageError !== null) return 'save-failed';
  if (input.queueState === 'conflict') return 'save-failed';
  if (input.draftWritePending) return 'saving-local';
  if (input.hasUncheckpointedDraft) return 'saved-local';
  if (input.queueState === 'sending') return 'syncing';
  if (input.queueState === 'pending') return 'saved-local';
  if (
    input.acceptedHeadRevisionId !== null &&
    input.localHeadRevisionId === input.acceptedHeadRevisionId
  )
    return 'saved-server';
  return 'saved-local';
}

/** What the note screen publishes to the header about the open note. */
export type NoteSaveFacts = {
  readonly state: SaveState;
  /** Text is typed but no version was created from it yet. */
  readonly hasUnsavedEdits: boolean;
};

/** The one save status the note screen shows: it saves, or it is saved. */
export type SaveStatus = 'saving' | 'saved';

/**
 * Selects the save status from the facts of the open note.
 *
 * The note saves itself, so the person reads one of two words. It is `saving`
 * while typed text is not yet a version, while a version write runs, and while
 * a save has not settled. It is `saved` once the note holds every edit as a
 * version. The device and the server are not told apart, because a person does
 * not act on that difference.
 */
export function resolveSaveStatus(note: NoteSaveFacts): SaveStatus {
  if (note.hasUnsavedEdits) return 'saving';
  if (note.state === 'saving-local' || note.state === 'syncing')
    return 'saving';
  if (note.state === 'save-failed' || note.state === 'storage-full')
    return 'saving';
  return 'saved';
}

/** The label of one save status. */
export function statusLabel(status: SaveStatus): string {
  return status === 'saving' ? 'Saving' : 'Saved';
}
