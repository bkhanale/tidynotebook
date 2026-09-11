import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNoteTree,
  mergeNotes,
  recentNotes,
  type NoteSummary,
} from './note-list.ts';

const note = (
  fileId: string,
  path: string,
  updatedAt: string,
): NoteSummary => ({
  fileId,
  path,
  updatedAt,
  localOnly: false,
  unsent: false,
});

await test('an attachment never reaches the note list', () => {
  const merged = mergeNotes(
    [
      {
        fileId: 'a',
        path: 'one.md',
        kind: 'note',
        headRevisionId: 'r1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        fileId: 'b',
        path: 'attachments/b-image.png',
        kind: 'attachment',
        headRevisionId: 'r2',
        createdAt: '2026-01-02T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ],
    [],
  );
  assert.deepEqual(
    merged.map((entry) => entry.fileId),
    ['a'],
  );
});

await test('a local draft marks the note as local only', () => {
  const merged = mergeNotes(
    [],
    [
      {
        fileId: 'c',
        path: 'fresh.md',
        kind: 'note',
        deleted: false,
        updatedAt: '2026-01-03T00:00:00Z',
        acceptedHeadRevisionId: null,
        localHeadRevisionId: null,
        localOnly: true,
      },
    ],
  );
  assert.equal(merged[0]?.localOnly, true);
});

await test('recent notes are the newest first', () => {
  const notes = [
    note('a', 'a.md', '2026-01-01T00:00:00Z'),
    note('b', 'b.md', '2026-01-05T00:00:00Z'),
    note('c', 'c.md', '2026-01-03T00:00:00Z'),
  ];
  assert.deepEqual(
    recentNotes(notes, 2).map((entry) => entry.fileId),
    ['b', 'c'],
  );
});

await test('the tree puts folders before notes at every level', () => {
  const tree = buildNoteTree([
    note('a', 'zebra.md', '2026-01-01T00:00:00Z'),
    note('b', 'plans/one.md', '2026-01-01T00:00:00Z'),
    note('c', 'plans/deep/two.md', '2026-01-01T00:00:00Z'),
  ]);
  assert.equal(tree[0]?.kind, 'folder');
  assert.equal(tree[1]?.kind, 'note');
  const plans = tree[0];
  assert.ok(plans !== undefined && plans.kind === 'folder');
  assert.equal(plans.fullPath, 'plans');
  assert.equal(plans.children[0]?.kind, 'folder');
  assert.equal(plans.children[1]?.kind, 'note');
});

await test('a folder with no note still reaches the tree', () => {
  const tree = buildNoteTree([], ['ideas/later']);
  assert.equal(tree.length, 1);
  const outer = tree[0];
  assert.ok(outer?.kind === 'folder');
  assert.equal(outer.fullPath, 'ideas');
  const inner = outer.children[0];
  assert.ok(inner?.kind === 'folder');
  assert.equal(inner.fullPath, 'ideas/later');
  assert.deepEqual(inner.children, []);
});
