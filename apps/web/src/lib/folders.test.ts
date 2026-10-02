import assert from 'node:assert/strict';
import test from 'node:test';
import type { NoteSummary } from './note-list.ts';
import {
  folderMoves,
  moveProblem,
  planDrop,
  planMove,
} from './folder-moves.ts';
import {
  pruneEmptyFolders,
  rewriteEmptyFolders,
  withEmptyFolder,
} from './empty-folders.ts';

const note = (fileId: string, path: string): NoteSummary => ({
  fileId,
  path,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  localOnly: false,
  unsent: false,
});

const notes: readonly NoteSummary[] = [
  note('a', 'plans/one.md'),
  note('b', 'plans/deep/two.md'),
  note('c', 'other.md'),
];

await test('a folder rename moves every note inside it and nothing else', () => {
  assert.deepEqual(folderMoves(notes, 'plans', 'roadmaps'), [
    { fileId: 'a', toPath: 'roadmaps/one.md' },
    { fileId: 'b', toPath: 'roadmaps/deep/two.md' },
  ]);
  assert.deepEqual(folderMoves(notes, 'missing', 'x'), []);
});

await test('a move onto an existing name is refused before the first write', () => {
  const problem = moveProblem([{ fileId: 'a', toPath: 'other.md' }], notes);
  assert.ok(String(problem).includes('already exists'));
});

await test('a move onto its own current name is allowed', () => {
  assert.equal(moveProblem([{ fileId: 'c', toPath: 'other.md' }], notes), null);
});

await test('a move to an invalid name states the cause', () => {
  const problem = moveProblem([{ fileId: 'a', toPath: 'a//b.md' }], notes);
  assert.ok(String(problem).includes('empty folder'));
});

await test('a move set that changes nothing says so', () => {
  assert.ok(String(moveProblem([], notes)).length > 0);
});

await test('a note dropped on a folder moves into it', () => {
  const outcome = planDrop(
    { kind: 'note', fileId: 'c', path: 'other.md' },
    'plans',
    notes,
  );
  assert.equal(outcome.problem, null);
  assert.deepEqual(outcome.plan?.moves, [
    { fileId: 'c', toPath: 'plans/other.md' },
  ]);
  assert.equal(outcome.plan?.folderMove, null);
});

await test('a note dropped on the root moves to the top', () => {
  const outcome = planDrop(
    { kind: 'note', fileId: 'a', path: 'plans/one.md' },
    '',
    notes,
  );
  assert.deepEqual(outcome.plan?.moves, [{ fileId: 'a', toPath: 'one.md' }]);
});

await test('a note dropped where it already is changes nothing', () => {
  const outcome = planDrop(
    { kind: 'note', fileId: 'a', path: 'plans/one.md' },
    'plans',
    notes,
  );
  assert.equal(outcome.plan, null);
  assert.equal(outcome.problem, null);
});

await test('a drop that would take a used name is refused', () => {
  const clash = [...notes, note('d', 'plans/other.md')];
  const outcome = planDrop(
    { kind: 'note', fileId: 'c', path: 'other.md' },
    'plans',
    clash,
  );
  assert.equal(outcome.plan, null);
  assert.ok(String(outcome.problem).includes('already exists'));
});

await test('a folder dropped on another folder nests inside it', () => {
  const outcome = planDrop({ kind: 'folder', folder: 'plans' }, 'archive', [
    ...notes,
    note('d', 'archive/old.md'),
  ]);
  assert.equal(outcome.problem, null);
  assert.deepEqual(outcome.plan?.moves, [
    { fileId: 'a', toPath: 'archive/plans/one.md' },
    { fileId: 'b', toPath: 'archive/plans/deep/two.md' },
  ]);
  assert.deepEqual(outcome.plan?.folderMove, {
    from: 'plans',
    to: 'archive/plans',
  });
});

await test('a folder cannot be dropped into itself or into its own child', () => {
  assert.ok(
    String(
      planDrop({ kind: 'folder', folder: 'plans' }, 'plans', notes).problem,
    ).length > 0,
  );
  assert.ok(
    String(
      planDrop({ kind: 'folder', folder: 'plans' }, 'plans/deep', notes)
        .problem,
    ).includes('into itself'),
  );
});

await test('a folder dropped where a folder of that name exists is refused', () => {
  const outcome = planDrop({ kind: 'folder', folder: 'deep' }, 'plans', [
    ...notes,
    note('d', 'deep/three.md'),
  ]);
  assert.equal(outcome.plan, null);
  assert.ok(String(outcome.problem).includes('already exists'));
});

await test('an empty folder moves with no note move at all', () => {
  const outcome = planDrop(
    { kind: 'folder', folder: 'ideas' },
    'plans',
    notes,
    ['ideas'],
  );
  assert.equal(outcome.problem, null);
  assert.deepEqual(outcome.plan?.moves, []);
  assert.deepEqual(outcome.plan?.folderMove, {
    from: 'ideas',
    to: 'plans/ideas',
  });
});

await test('a remembered empty folder blocks a drop of the same name', () => {
  const outcome = planDrop(
    { kind: 'folder', folder: 'ideas' },
    'plans',
    notes,
    ['ideas', 'plans/ideas'],
  );
  assert.equal(outcome.plan, null);
  assert.ok(String(outcome.problem).includes('already exists'));
});

await test('an empty folder is forgotten once it holds a note', () => {
  assert.deepEqual(pruneEmptyFolders(['ideas', 'plans'], ['plans/one.md']), [
    'ideas',
  ]);
  assert.deepEqual(withEmptyFolder(['plans'], 'ideas'), ['ideas', 'plans']);
  assert.deepEqual(withEmptyFolder(['ideas'], 'ideas'), ['ideas']);
});

await test('a folder move rewrites every empty folder inside it', () => {
  assert.deepEqual(
    rewriteEmptyFolders(
      ['ideas', 'ideas/later', 'plans'],
      'ideas',
      'plans/ideas',
    ),
    ['plans', 'plans/ideas', 'plans/ideas/later'],
  );
  assert.deepEqual(rewriteEmptyFolders(['a/b'], 'a', ''), ['b']);
});

await test('a move of several rows moves every row in one plan', () => {
  // Issue 255: a person moved ten notes with ten drags.
  const outcome = planMove(
    [
      { kind: 'note', fileId: 'c', path: 'other.md' },
      { kind: 'folder', folder: 'plans/deep' },
    ],
    'archive',
    notes,
  );
  assert.equal(outcome.problem, null);
  assert.deepEqual(outcome.plan, {
    moves: [
      { fileId: 'c', toPath: 'archive/other.md' },
      { fileId: 'b', toPath: 'archive/deep/two.md' },
    ],
    folderMoves: [{ from: 'plans/deep', to: 'archive/deep' }],
  });
});

await test('a row inside a moved folder travels with the folder', () => {
  const outcome = planMove(
    [
      { kind: 'folder', folder: 'plans' },
      { kind: 'note', fileId: 'a', path: 'plans/one.md' },
    ],
    'archive',
    notes,
  );
  assert.deepEqual(outcome.plan?.moves, [
    { fileId: 'a', toPath: 'archive/plans/one.md' },
    { fileId: 'b', toPath: 'archive/plans/deep/two.md' },
  ]);
});

await test('two rows that land on one name refuse the whole move', () => {
  const twins = [note('x', 'one/same.md'), note('y', 'two/same.md')];
  const outcome = planMove(
    [
      { kind: 'note', fileId: 'x', path: 'one/same.md' },
      { kind: 'note', fileId: 'y', path: 'two/same.md' },
    ],
    'archive',
    twins,
  );
  assert.equal(outcome.plan, null);
  assert.match(outcome.problem ?? '', /^Two notes would be named/u);
});

await test('one refused row refuses the move and a move in place does nothing', () => {
  assert.equal(
    planMove([{ kind: 'folder', folder: 'plans' }], 'plans/deep', notes).plan,
    null,
  );
  assert.deepEqual(
    planMove(
      [{ kind: 'note', fileId: 'a', path: 'plans/one.md' }],
      'plans',
      notes,
    ),
    { plan: null, problem: null },
  );
});
