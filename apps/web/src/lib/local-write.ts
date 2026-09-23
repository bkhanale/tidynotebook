/**
 * What the open note says when a write to local storage fails.
 *
 * The note saves itself, so no Save button reports a failure (record 0022).
 * The editor keeps the typed text in the tab, but the person must know that
 * it is only there: a closed tab loses it. This module chooses the one
 * sentence for each kind of failure, with the step that helps, and it is the
 * only statement of it. The sidebar footer reads `localWriteFailed` from the
 * same kind, so it stops claiming that everything is saved.
 *
 * A `stale` refusal writes nothing and loses nothing: the store holds a newer
 * statement of the note, and the editor reads it. So it is not a failure that
 * the person must hear about.
 */
import type { LocalStorageErrorKind } from '@notesapp/sync';

/** Whether a failed local write leaves the typed text only in this tab. */
export function localWriteFailed(kind: LocalStorageErrorKind | null): boolean {
  return kind !== null && kind !== 'stale';
}

/**
 * The one sentence for a failed local write, or `null` when there is none.
 *
 * Each sentence states that the changes are not saved, and then the step that
 * helps. It names no engine, no code, and no identifier.
 */
export function localWriteFailureMessage(
  kind: LocalStorageErrorKind | null,
): string | null {
  if (kind === null || kind === 'stale') return null;
  if (kind === 'quota')
    return 'This device is full, so your changes are not saved. Free space on the device, then type again to save.';
  if (kind === 'unavailable')
    return 'Local storage stopped in this tab, so your changes are not saved. Copy your text, then reload the tab.';
  if (kind === 'corrupt')
    return 'Local storage cannot be read, so your changes are not saved. Copy your text, close the other tabs of Notesapp, then reload this tab.';
  return 'Your last change is not saved on this device. Type again to save it, and keep this tab open until then.';
}
