/**
 * The typed sync state of the open notes area.
 *
 * The sync engine announces events for engineers. This module turns each of
 * them into one typed state, and a second function turns a state into one
 * plain sentence. Nothing in the interface reads engine prose, so a copy
 * change can never break a condition, and no identifier, code, or count of
 * internal objects reaches the person.
 */
import type { SyncNotice } from '@notesapp/sync';

/** Where sync stands right now. */
export type SyncState =
  /** The engine has not reported anything yet. */
  | { readonly kind: 'starting' }
  /** Everything on this device reached the server. */
  | { readonly kind: 'in-step' }
  /** A save is on its way to the server. */
  | { readonly kind: 'sending' }
  /** The device has no connection, so saves wait here. */
  | { readonly kind: 'waiting' }
  /** A save was refused and waits in the Needs attention list. */
  | { readonly kind: 'attention'; readonly fileId: string | undefined }
  /** A later save replaced text that another device had saved. */
  | { readonly kind: 'superseded'; readonly path: string }
  /** A delete did not run because the note changed elsewhere. */
  | { readonly kind: 'delete-refused'; readonly path: string }
  /** The session ended, so sync stopped until the person signs in. */
  | { readonly kind: 'signed-out' }
  /** Another tab of this browser drives sync. */
  | { readonly kind: 'other-tab' }
  /** Sync stopped for a reason the person cannot act on directly. */
  | { readonly kind: 'stopped' };

/** The first state of a session, before the engine reports anything. */
export const startingSyncState: SyncState = { kind: 'starting' };

/**
 * Selects the state for one engine notice.
 *
 * Returns `null` for a notice that does not change what the person sees,
 * such as an internal snapshot restart, so the previous state stays.
 */
export function syncStateOfNotice(notice: SyncNotice): SyncState | null {
  if (notice.kind === 'pushed') return { kind: 'in-step' };
  if (notice.kind === 'preserved')
    return { kind: 'attention', fileId: notice.fileIds[0] };
  if (notice.kind === 'superseded')
    return { kind: 'superseded', path: notice.path };
  if (notice.kind === 'delete-refused')
    return { kind: 'delete-refused', path: notice.path };
  if (notice.kind === 'retry') return { kind: 'waiting' };
  if (notice.kind === 'snapshot-activated' || notice.kind === 'changes-applied')
    return { kind: 'in-step' };
  if (notice.kind === 'paused') return { kind: 'signed-out' };
  if (notice.kind === 'lease-held') return { kind: 'other-tab' };
  if (notice.kind === 'lease-lost') return { kind: 'waiting' };
  if (notice.kind === 'access-lost' || notice.kind === 'cycle-error')
    return { kind: 'stopped' };
  return null;
}

/**
 * One plain sentence for a sync state.
 *
 * `noteName` is the name of the note the state refers to, when the caller
 * could read it. The sentence never shows a path with its `.md` suffix and
 * never shows an identifier.
 */
export function syncStateMessage(
  state: SyncState,
  noteName: string | null = null,
): string {
  const named = noteName === null || noteName === '' ? 'A note' : noteName;
  if (state.kind === 'starting') return 'Connecting to the server.';
  if (state.kind === 'in-step') return 'Everything is saved to the server.';
  if (state.kind === 'sending') return 'Sending your save to the server.';
  if (state.kind === 'waiting')
    return 'No connection. Your saves are on this device and go up when the connection returns.';
  if (state.kind === 'attention')
    return `${named} could not be saved to the server. Open Needs attention to keep the text.`;
  if (state.kind === 'superseded')
    return `Your save of ${named} is now the latest version. The text from the other device is in History.`;
  if (state.kind === 'delete-refused')
    return `${named} changed on another device, so it was not deleted.`;
  if (state.kind === 'signed-out')
    return 'The session ended. Sign in again to save to the server.';
  if (state.kind === 'other-tab')
    return 'Another tab of this browser is saving to the server.';
  return 'Saving to the server stopped. Your work stays on this device.';
}

/** Whether a state asks the person to do something. */
export function syncNeedsAttention(state: SyncState): boolean {
  return (
    state.kind === 'attention' ||
    state.kind === 'signed-out' ||
    state.kind === 'stopped' ||
    state.kind === 'delete-refused'
  );
}

/** The note a state speaks about, when it names one. */
export function syncStateFileId(state: SyncState): string | null {
  if (state.kind === 'attention') return state.fileId ?? null;
  return null;
}
