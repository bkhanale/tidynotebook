import assert from 'node:assert/strict';
import test from 'node:test';
import type { NoteSummary } from './note-list.ts';
import { trashPlan } from './tree-trash.ts';

const note = (fileId: string, path: string): NoteSummary => ({
  fileId,
  path,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  localOnly: false,
  unsent: false,
});

const notes = [
  note('a', 'Work/Plan.md'),
  note('b', 'Work/Deep/Q1.md'),
  note('c', 'Ideas.md'),
  note('d', 'Home/List.md'),
];

await test('a selection of notes and folders moves every note once', () => {
  // Issue 255: a move to Trash acted on one row only.
  const plan = trashPlan(
    [
      { kind: 'folder', path: 'Work' },
      { kind: 'note', fileId: 'b', path: 'Work/Deep/Q1.md' },
      { kind: 'note', fileId: 'c', path: 'Ideas.md' },
    ],
    notes,
  );
  assert.deepEqual(plan.items, [
    { fileId: 'a', name: 'Work/Plan' },
    { fileId: 'b', name: 'Work/Deep/Q1' },
    { fileId: 'c', name: 'Ideas' },
  ]);
  assert.deepEqual(plan.dropFolders, ['Work']);
  // The folder of a note inside a moved folder leaves with that folder.
  assert.deepEqual(plan.keepFolders, []);
});

await test('the folder of a note that leaves stays on the device', () => {
  const plan = trashPlan(
    [{ kind: 'note', fileId: 'd', path: 'Home/List.md' }],
    notes,
  );
  assert.deepEqual(plan.keepFolders, ['Home']);
  assert.deepEqual(plan.dropFolders, []);
});

await test('an empty folder moves no note and leaves the tree', () => {
  const plan = trashPlan([{ kind: 'folder', path: 'Empty' }], notes);
  assert.deepEqual(plan, {
    items: [],
    keepFolders: [],
    dropFolders: ['Empty'],
  });
});

await test('a folder that leaves keeps the folder that holds it', () => {
  // The review of the merged branch: trashing Work/Deep dropped Work from
  // the tree when Work held no other note.
  const plan = trashPlan(
    [{ kind: 'folder', path: 'Work/Deep' }],
    [note('b', 'Work/Deep/Q1.md')],
  );
  assert.deepEqual(plan.keepFolders, ['Work']);
  assert.deepEqual(plan.dropFolders, ['Work/Deep']);
});
