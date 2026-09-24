import assert from 'node:assert/strict';
import test from 'node:test';
import { freeNotePath, newNoteDraft } from './new-note-draft.ts';

await test('a new note is empty', () => {
  const draft = newNoteDraft({
    accountId: 'account',
    workspaceId: 'workspace',
    path: 'New note.md',
    ids: { fileId: 'file', workingCopyId: 'copy' },
  });
  assert.equal(draft.text, '');
  assert.equal(draft.path, 'New note.md');
  assert.equal(draft.baseRevisionId, null);
  assert.equal(draft.deleted, false);
});

await test('a daily note starts with the text of its template', () => {
  const draft = newNoteDraft({
    accountId: 'account',
    workspaceId: 'workspace',
    path: 'Daily notes/2026-09-24.md',
    ids: { fileId: 'file', workingCopyId: 'copy' },
    text: '# Plan\n\n- [ ] \n',
  });
  assert.equal(draft.text, '# Plan\n\n- [ ] \n');
  assert.equal(draft.path, 'Daily notes/2026-09-24.md');
  // It is a new note all the same: no base, and the first sequence.
  assert.equal(draft.baseRevisionId, null);
  assert.equal(draft.sequence, 1);
});

await test('the first free name at the root is New note', () => {
  assert.equal(freeNotePath([], ''), 'New note.md');
  assert.equal(freeNotePath(['new note.md'], ''), 'New note 2.md');
  assert.equal(
    freeNotePath(['New note.md', 'New note 2.md'], ''),
    'New note 3.md',
  );
});

await test('a new note in a folder counts only that folder', () => {
  assert.equal(freeNotePath(['New note.md'], 'Work'), 'Work/New note.md');
  assert.equal(
    freeNotePath(['Work/new note.md'], 'Work'),
    'Work/New note 2.md',
  );
});
