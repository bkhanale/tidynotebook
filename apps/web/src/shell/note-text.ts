/**
 * The text of one note of the open workspace, for a template (records 0099
 * and 0149).
 *
 * A new daily note and an insert from a template both start from the text of
 * another note, and both read it here. The local store answers first, with
 * the newest draft of this device. A note this device has not received yet
 * comes from the generated `getFile`.
 */
import { getFile } from '@notesapp/api-client';
import type { LocalStore } from '@notesapp/sync';

/** The text of one note, or `null` when this device cannot read it. */
export async function readNoteText(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  fileId: string,
): Promise<string | null> {
  try {
    const cached = await store.readCachedNote(accountId, workspaceId, fileId);
    if (cached !== null && !cached.deleted) return cached.text;
  } catch {
    // The server read below can still answer.
  }
  try {
    const result = await getFile({ path: { workspaceId, fileId } });
    if (result.error !== undefined || result.data === undefined) return null;
    const text = result.data.head?.text;
    return typeof text === 'string' ? text : null;
  } catch {
    // No connection is a text that this device cannot read.
    return null;
  }
}
