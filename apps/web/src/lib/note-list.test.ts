import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ancestorFolders,
  buildNoteTree,
  mergeNotes,
  notesInFolder,
  recentNotes,
  type NoteSummary,
  type TreeNode,
} from './note-list.ts';

const note = (
  fileId: string,
  path: string,
  updatedAt: string,
): NoteSummary => ({
  fileId,
  path,
  createdAt: updatedAt,
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

await test('a note keeps the creation instant of the server', () => {
  const merged = mergeNotes(
    [
      {
        fileId: 'a',
        path: 'one.md',
        kind: 'note',
        headRevisionId: 'r1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-04T00:00:00Z',
      },
    ],
    [],
  );
  assert.equal(merged[0]?.createdAt, '2026-01-01T00:00:00Z');
  assert.equal(merged[0]?.updatedAt, '2026-01-04T00:00:00Z');
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

/** The folder and note names of one level of the tree, in its order. */
const namesOf = (nodes: readonly TreeNode[]): readonly string[] =>
  nodes.map((node) => (node.kind === 'folder' ? node.name : node.basename));

await test('the tree sorts folders and notes in alphabet order without case', () => {
  const tree = buildNoteTree(
    [
      note('a', 'Banana.md', '2026-01-01T00:00:00Z'),
      note('b', 'apple.md', '2026-01-01T00:00:00Z'),
      note('c', 'Zoo/one.md', '2026-01-01T00:00:00Z'),
      note('d', 'work/two.md', '2026-01-01T00:00:00Z'),
    ],
    [],
    'name',
  );
  assert.deepEqual(namesOf(tree), ['work', 'Zoo', 'apple.md', 'Banana.md']);
});

await test('the tree sorts the notes of each folder in the chosen order', () => {
  const notes = [
    {
      ...note('a', 'plans/old.md', '2026-01-09T00:00:00Z'),
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      ...note('b', 'plans/new.md', '2026-01-02T00:00:00Z'),
      createdAt: '2026-01-02T00:00:00Z',
    },
    {
      ...note('c', 'plans/mid.md', '2026-01-05T00:00:00Z'),
      createdAt: '2026-01-01T12:00:00Z',
    },
  ];
  const plansOf = (tree: readonly TreeNode[]): readonly string[] => {
    const plans = tree[0];
    assert.ok(plans?.kind === 'folder');
    return namesOf(plans.children);
  };
  assert.deepEqual(plansOf(buildNoteTree(notes, [], 'name')), [
    'mid.md',
    'new.md',
    'old.md',
  ]);
  assert.deepEqual(plansOf(buildNoteTree(notes, [], 'created')), [
    'new.md',
    'mid.md',
    'old.md',
  ]);
  assert.deepEqual(plansOf(buildNoteTree(notes, [], 'updated')), [
    'old.md',
    'mid.md',
    'new.md',
  ]);
});

await test('a date order keeps the folders first and in name order', () => {
  const tree = buildNoteTree(
    [
      note('a', 'loose.md', '2026-01-09T00:00:00Z'),
      note('b', 'zoo/one.md', '2026-01-01T00:00:00Z'),
      note('c', 'alpha/two.md', '2026-01-02T00:00:00Z'),
    ],
    ['Beta'],
    'updated',
  );
  assert.deepEqual(namesOf(tree), ['alpha', 'Beta', 'zoo', 'loose.md']);
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

const until = '2026-01-01T00:00:00Z';

const inFolders = [
  note('direct', 'Work/Note.md', until),
  note('nested', 'Work/Plans/2026.md', until),
  note('sibling', 'Personal/Ideas.md', until),
  note('top', 'Loose.md', until),
  note('prefix', 'Workshop/Note.md', until),
  note('outside', 'Workspace/Note.md', until),
];

await test('notesInFolder includes a note directly in the folder', () => {
  assert.deepEqual(
    notesInFolder(inFolders, 'Work').map((entry) => entry.fileId),
    ['direct', 'nested'],
  );
});

await test('notesInFolder includes notes in nested folders', () => {
  assert.ok(
    notesInFolder(inFolders, 'Work/Plans').some(
      (entry) => entry.fileId === 'nested',
    ),
  );
});

await test('notesInFolder excludes a sibling folder', () => {
  assert.ok(
    !notesInFolder(inFolders, 'Work').some(
      (entry) => entry.fileId === 'sibling',
    ),
  );
});

await test('notesInFolder excludes a top-level note', () => {
  assert.ok(
    !notesInFolder(inFolders, 'Work').some((entry) => entry.fileId === 'top'),
  );
});

await test('notesInFolder excludes Workshop when the folder is Work', () => {
  assert.ok(
    !notesInFolder(inFolders, 'Work').some(
      (entry) => entry.fileId === 'prefix',
    ),
  );
  assert.ok(
    !notesInFolder(inFolders, 'Work').some(
      (entry) => entry.fileId === 'outside',
    ),
  );
});

await test('notesInFolder matches a folder without case', () => {
  assert.deepEqual(
    notesInFolder(inFolders, 'work').map((entry) => entry.fileId),
    ['direct', 'nested'],
  );
});

await test('notesInFolder preserves the input order', () => {
  const ordered = [
    note('second', 'Work/Second.md', until),
    note('first', 'Work/First.md', until),
  ];
  assert.deepEqual(
    notesInFolder(ordered, 'Work').map((entry) => entry.fileId),
    ['second', 'first'],
  );
});

await test('ancestorFolders lists each folder that holds a nested note', () => {
  assert.deepEqual(ancestorFolders('Work/Reports/Q1.md'), [
    'Work',
    'Work/Reports',
  ]);
});

await test('ancestorFolders is empty for a root note', () => {
  assert.deepEqual(ancestorFolders('Q1.md'), []);
});

await test('ancestorFolders lists the one folder of a note one level deep', () => {
  assert.deepEqual(ancestorFolders('Work/Q1.md'), ['Work']);
});
