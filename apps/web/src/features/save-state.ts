/**
 * The save state of one note and the state of the header chip.
 *
 * `resolveSaveState` reads durable facts about one file only.
 * `resolveChipState` joins that with the state of sync, the parked saves,
 * and the connection, so the header shows one state at every width and
 * every screen agrees with it.
 */
import type { LocalStorageErrorKind, QueueState } from '@notesapp/sync';
import type { SyncState } from './sync-state.ts';

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

/** The one state the header chip shows. */
export type ChipState =
  | { readonly kind: 'unsaved' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved-local' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'attention'; readonly count: number };

/** Everything the chip reads. */
export type ChipInput = {
  /** The open note, or `null` on a screen without one. */
  readonly note: NoteSaveFacts | null;
  readonly sync: SyncState;
  /** How many saves wait in the Needs attention list. */
  readonly attentionCount: number;
  readonly online: boolean;
};

/**
 * Selects the one state of the header chip.
 *
 * A problem always wins, because it is the only state that asks the person
 * to act. After that the state of the open note wins over the state of the
 * area, because the person is looking at that note.
 */
export function resolveChipState(input: ChipInput): ChipState {
  const failed =
    input.note?.state === 'save-failed' || input.note?.state === 'storage-full';
  if (failed)
    return { kind: 'attention', count: Math.max(input.attentionCount, 1) };
  if (input.attentionCount > 0)
    return { kind: 'attention', count: input.attentionCount };
  if (input.sync.kind === 'signed-out' || input.sync.kind === 'stopped')
    return { kind: 'attention', count: input.attentionCount };
  const offline = !input.online || input.sync.kind === 'waiting';
  if (input.note === null)
    return offline ? { kind: 'offline' } : { kind: 'saved' };
  if (input.note.state === 'saving-local') return { kind: 'saving' };
  if (input.note.hasUnsavedEdits) return { kind: 'unsaved' };
  if (input.note.state === 'syncing') return { kind: 'saving' };
  if (offline) return { kind: 'saved-local' };
  if (input.note.state === 'saved-server') return { kind: 'saved' };
  return { kind: 'saved-local' };
}

/** The short label of one chip state. */
export function chipLabel(state: ChipState): string {
  if (state.kind === 'unsaved') return 'Unsaved changes';
  if (state.kind === 'saving') return 'Saving';
  if (state.kind === 'saved-local') return 'Saved on this device';
  if (state.kind === 'saved') return 'Saved';
  if (state.kind === 'offline') return 'Offline';
  if (state.count > 0) return `Needs attention (${String(state.count)})`;
  return 'Needs attention';
}

/** Whether the chip reports something the person has to answer. */
export function chipIsProblem(state: ChipState): boolean {
  return state.kind === 'attention';
}
