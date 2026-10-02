/**
 * The text of one note of the open workspace, for a template (records 0099
 * and 0149).
 *
 * A new daily note and an insert from a template both start from the text of
 * another note, and both read it here. The local store answers first, with
 * the newest draft of this device. A note this device has not received yet
 * comes from the generated `getFile`. A read with no connection is a text
 * that this device cannot read, so the caller states its one sentence and
 * never fails in silence.
 */
import { getFile } from '@notesapp/api-client';
import type { LocalStore } from '@notesapp/sync';

/** Reads the head text of one note from the server, or `null`. */
export type ServerNoteText = (
  workspaceId: string,
  fileId: string,
) => Promise<string | null>;

/** The head text of one note through the generated `getFile`. */
const serverNoteText: ServerNoteText = async (workspaceId, fileId) => {
  // A template needs the text and no document (record 0168).
  const result = await getFile({
    path: { workspaceId, fileId },
    query: { content: 'text' },
  });
  if (result.error !== undefined || result.data === undefined) return null;
  const text = result.data.head?.text;
  return typeof text === 'string' ? text : null;
};

/** The text of one note, or `null` when this device cannot read it. */
export async function readNoteText(
  store: Pick<LocalStore, 'readCachedNote'>,
  accountId: string,
  workspaceId: string,
  fileId: string,
  readServer: ServerNoteText = serverNoteText,
): Promise<string | null> {
  try {
    const cached = await store.readCachedNote(accountId, workspaceId, fileId);
    if (cached !== null && !cached.deleted) return cached.text;
  } catch {
    // The server read below can still answer.
  }
  try {
    return await readServer(workspaceId, fileId);
  } catch {
    // No connection is a text that this device cannot read.
    return null;
  }
}
