import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNoteTree, type NoteSummary } from './note-list.ts';
import {
  actionableKeys,
  folderRowKey,
  noteRowKey,
  visibleTreeRows,
} from './tree-rows.ts';

/** One note of a fixture, at a path. */
function note(fileId: string, path: string): NoteSummary {
  return {
    fileId,
    path,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    localOnly: false,
    unsent: false,
  };
}

const notes = [
  note('a', 'Work/Plan.md'),
  note('b', 'Work/Reports/Q1.md'),
  note('c', 'Ideas.md'),
  note('d', 'Work/Budget.md'),
];
const tree = buildNoteTree(notes, ['Empty']);

await test('a closed tree shows its top rows with their place', () => {
  const rows = visibleTreeRows(tree, new Set());
  assert.deepEqual(
    rows.map((row) =>
      row.kind === 'empty'
        ? row.key
        : [row.key, row.level, row.posInSet, row.setSize],
    ),
    [
      ['folder:Empty', 1, 1, 3],
      ['folder:Work', 1, 2, 3],
      ['note:c', 1, 3, 3],
    ],
  );
});

await test('an open folder lists its rows below it, one level in', () => {
  const rows = visibleTreeRows(tree, new Set(['Work', 'Work/Reports']));
  assert.deepEqual(
    rows.map((row) => row.key),
    [
      'folder:Empty',
      'folder:Work',
      'folder:Work/Reports',
      'note:b',
      'note:d',
      'note:a',
      'note:c',
    ],
  );
  const q1 = rows.find((row) => row.key === 'note:b');
  assert.ok(q1 !== undefined && q1.kind === 'note');
  assert.equal(q1.level, 3);
  assert.equal(q1.parentKey, 'folder:Work/Reports');
  assert.equal(q1.name, 'Q1');
  const work = rows.find((row) => row.key === 'folder:Work');
  assert.ok(work !== undefined && work.kind === 'folder');
  assert.equal(work.expanded, true);
});

await test('an open folder with no row shows one line that takes no place', () => {
  const rows = visibleTreeRows(tree, new Set(['Empty']));
  assert.deepEqual(rows[1], {
    kind: 'empty',
    key: 'empty:Empty',
    level: 2,
    parentKey: 'folder:Empty',
  });
  assert.ok(!actionableKeys(rows).includes('empty:Empty'));
  assert.equal(actionableKeys(rows).length, rows.length - 1);
});

await test('the keys of a folder and a note never meet', () => {
  assert.notEqual(folderRowKey('a'), noteRowKey('a'));
});
