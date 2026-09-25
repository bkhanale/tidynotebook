/**
 * The one way to make a note on this device.
 *
 * To make a note is a natural boundary, so the first draft and its checkpoint
 * go together and the create waits in the queue at once (record 0104). The
 * queue change wakes the sync engine, so the note reaches the server with no
 * edit. No surface writes the first draft of a note alone.
 */
import { saveCheckpointMessage } from './checkpoints.ts';
import type { Draft, LocalStore } from './local-port.ts';

/** The part of the local store that making a note uses. */
export type NoteCreationStore = Pick<
  LocalStore,
  'saveDraft' | 'checkpoint' | 'dropDraft'
>;

/**
 * Writes the first draft of one new note and queues its create.
 *
 * Either both records exist or neither does. When the checkpoint fails, the
 * draft is dropped again, so the tree never shows a note that no save sends,
 * and the failure of the checkpoint reaches the caller.
 */
export async function createNote(
  local: NoteCreationStore,
  draft: Draft,
): Promise<void> {
  await local.saveDraft(draft);
  try {
    await local.checkpoint(draft, saveCheckpointMessage);
  } catch (failure: unknown) {
    await local
      .dropDraft(draft.accountId, draft.workspaceId, draft.workingCopyId)
      .catch(() => {
        // The failure of the checkpoint is the one the caller reports.
      });
    throw failure;
  }
}
