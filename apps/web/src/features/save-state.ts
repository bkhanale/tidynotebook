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

/** The one state the Save button of the note header shows. */
export type SaveButtonState = 'save' | 'saving' | 'saved-local' | 'saved';

/**
 * Selects the state of the Save button from the facts of the open note.
 *
 * Typed text that no version holds yet always wins, so the button offers
 * the action while a draft write is still in flight. A failed save also
 * leaves the button ready, because the person has to try again. Everything
 * else reports the result: the save is running, the version waits on this
 * device, or the server holds it.
 */
export function resolveSaveButton(note: NoteSaveFacts): SaveButtonState {
  if (note.state === 'save-failed' || note.state === 'storage-full')
    return 'save';
  if (note.hasUnsavedEdits) return 'save';
  if (note.state === 'saving-local' || note.state === 'syncing')
    return 'saving';
  if (note.state === 'saved-server') return 'saved';
  return 'saved-local';
}

/** The label of one Save button state. */
export function buttonLabel(state: SaveButtonState): string {
  if (state === 'save') return 'Save';
  if (state === 'saving') return 'Saving';
  if (state === 'saved-local') return 'Saved on this device';
  return 'Saved';
}

/** Whether the Save button accepts a press in this state. */
export function buttonEnabled(state: SaveButtonState): boolean {
  return state === 'save';
}
