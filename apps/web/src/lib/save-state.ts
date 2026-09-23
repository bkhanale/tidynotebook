/**
 * The save state of one note.
 *
 * `resolveSaveState` reads durable facts about one file only. The note saves
 * itself, so no control shows this state; the shell reads it for the facts it
 * needs about the open note, and the sidebar footer states the sync progress
 * of the whole notes area.
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

/** What the note screen publishes to the shell about the open note. */
export type NoteSaveFacts = {
  readonly state: SaveState;
  /** Text is typed but no version was created from it yet. */
  readonly hasUnsavedEdits: boolean;
  /**
   * A write to local storage failed, so the typed text is only in this tab.
   * `lib/local-write.ts` decides it.
   */
  readonly localWriteFailed: boolean;
};
