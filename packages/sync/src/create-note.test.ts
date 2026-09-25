/** Making a note queues its create at once (record 0104). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNote, type NoteCreationStore } from './create-note.ts';
import type { Draft } from './local-port.ts';
import { LocalStorageError } from './local-port.ts';

const draft: Draft = {
  accountId: 'account-1',
  workspaceId: 'workspace-1',
  workingCopyId: 'working-1',
  fileId: 'file-1',
  baseRevisionId: null,
  text: '# Today\n',
  path: 'Daily notes/2026-09-25.md',
  deleted: false,
  sequence: 1,
};

/** A store that records each call, and fails the checkpoint when asked. */
function recordingStore(failCheckpoint: boolean): {
  readonly store: NoteCreationStore;
  readonly calls: string[];
  readonly checkpointed: Draft[];
} {
  const calls: string[] = [];
  const checkpointed: Draft[] = [];
  const store: NoteCreationStore = {
    saveDraft: (saved) => {
      calls.push(`draft ${saved.workingCopyId}`);
      return Promise.resolve();
    },
    checkpoint: (saved, message) => {
      calls.push(`checkpoint ${saved.workingCopyId} ${String(message)}`);
      if (failCheckpoint)
        return Promise.reject(new LocalStorageError('quota', 'full'));
      checkpointed.push(saved);
      return Promise.resolve(null);
    },
    dropDraft: (accountId, workspaceId, workingCopyId) => {
      calls.push(`drop ${accountId} ${workspaceId} ${workingCopyId}`);
      return Promise.resolve();
    },
  };
  return { store, calls, checkpointed };
}

await test('a new note writes its draft and then queues its create', async () => {
  const { store, calls, checkpointed } = recordingStore(false);
  await createNote(store, draft);
  assert.deepEqual(calls, ['draft working-1', 'checkpoint working-1 null']);
  assert.deepEqual(checkpointed, [draft]);
});

await test('a failed checkpoint drops the draft and reports the failure', async () => {
  const { store, calls } = recordingStore(true);
  await assert.rejects(
    createNote(store, draft),
    (failure: unknown) =>
      failure instanceof LocalStorageError && failure.kind === 'quota',
  );
  assert.deepEqual(calls, [
    'draft working-1',
    'checkpoint working-1 null',
    'drop account-1 workspace-1 working-1',
  ]);
});
