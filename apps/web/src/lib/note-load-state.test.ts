import assert from 'node:assert/strict';
import test from 'node:test';
import { noteLoadStatusFor, type NoteLoadState } from './note-load-state.ts';

const current = {
  accountId: 'account-one',
  workspaceId: 'workspace-one',
  fileId: 'new-note',
};

await test('a new note cannot use the path of the note before it', () => {
  // Issue 143. React can render once with the last loader state before the
  // effect for a changed file starts. That state must not reach the editor.
  const previous: NoteLoadState = {
    identity: {
      accountId: 'account-one',
      workspaceId: 'workspace-one',
      fileId: 'deleted-note',
    },
    status: {
      kind: 'ready',
      path: 'Deleted folder/Old name.md',
      text: 'old text',
      headRevisionId: 'old-revision',
      sequence: 4,
    },
  };

  assert.deepEqual(noteLoadStatusFor(previous, current), { kind: 'loading' });
});

await test('loader state belongs to its account and workspace too', () => {
  const previous: NoteLoadState = {
    identity: {
      accountId: 'other-account',
      workspaceId: 'other-workspace',
      fileId: 'new-note',
    },
    status: { kind: 'deleted', path: 'Old folder/Old note.md' },
  };

  assert.deepEqual(noteLoadStatusFor(previous, current), { kind: 'loading' });
});

await test('the current note can use its completed loader state', () => {
  const ready: NoteLoadState = {
    identity: current,
    status: {
      kind: 'ready',
      path: 'Selected folder/New note.md',
      text: '',
      headRevisionId: null,
      sequence: 0,
    },
  };

  assert.equal(noteLoadStatusFor(ready, current), ready.status);
});
