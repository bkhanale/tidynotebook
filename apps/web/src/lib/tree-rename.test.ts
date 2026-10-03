import assert from 'node:assert/strict';
import test from 'node:test';
import type { MoveArea } from './folder-moves.ts';
import type { NameInUse, NoteSummary } from './note-list.ts';
import { renamePlan, renameStartName } from './tree-rename.ts';

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
  note('b', 'Work/Budget.md'),
  note('c', 'Work/Deep/Q1.md'),
];
const folders = ['Work', 'Work/Deep', 'Ideas'];

/** The area of these notes, with any other name that the server holds. */
const area = (
  list: readonly NoteSummary[],
  held: readonly NameInUse[] = [],
): MoveArea => ({ notes: list, namesInUse: [...list, ...held] });

await test('a note renamed in place keeps its folder', () => {
  // Issue 255: no row renamed with F2.
  assert.deepEqual(
    renamePlan(
      { kind: 'note', fileId: 'a', path: 'Work/Plan.md' },
      ' Roadmap ',
      area(notes),
      folders,
    ),
    {
      kind: 'rename',
      moves: [{ fileId: 'a', toPath: 'Work/Roadmap.md' }],
      folder: null,
    },
  );
});

await test('a note name that another note holds is refused', () => {
  const outcome = renamePlan(
    { kind: 'note', fileId: 'a', path: 'Work/Plan.md' },
    'budget',
    area(notes),
    folders,
  );
  assert.equal(outcome.kind, 'refused');
  assert.match(
    outcome.kind === 'refused' ? outcome.problem : '',
    /^Another note is already named/u,
  );
});

await test('a slash and an empty name are refused, and the same name is no change', () => {
  const target = { kind: 'note', fileId: 'a', path: 'Work/Plan.md' } as const;
  assert.equal(renamePlan(target, 'a/b', area(notes), folders).kind, 'refused');
  assert.equal(renamePlan(target, '  ', area(notes), folders).kind, 'refused');
  assert.deepEqual(renamePlan(target, 'Plan.md', area(notes), folders), {
    kind: 'unchanged',
  });
});

await test('a folder renamed in place renames the path of every note inside', () => {
  assert.deepEqual(
    renamePlan({ kind: 'folder', path: 'Work' }, 'Jobs', area(notes), folders),
    {
      kind: 'rename',
      moves: [
        { fileId: 'a', toPath: 'Jobs/Plan.md' },
        { fileId: 'b', toPath: 'Jobs/Budget.md' },
        { fileId: 'c', toPath: 'Jobs/Deep/Q1.md' },
      ],
      folder: { from: 'Work', to: 'Jobs' },
    },
  );
});

await test('a folder keeps its parent and refuses a name its parent holds', () => {
  assert.deepEqual(
    renamePlan(
      { kind: 'folder', path: 'Work/Deep' },
      'Shallow',
      area(notes),
      folders,
    ),
    {
      kind: 'rename',
      moves: [{ fileId: 'c', toPath: 'Work/Shallow/Q1.md' }],
      folder: { from: 'Work/Deep', to: 'Work/Shallow' },
    },
  );
  const taken = renamePlan(
    { kind: 'folder', path: 'Work' },
    'ideas',
    area(notes),
    folders,
  );
  assert.equal(taken.kind, 'refused');
  assert.match(
    taken.kind === 'refused' ? taken.problem : '',
    /^A folder named ideas already exists there/u,
  );
  const slash = renamePlan(
    { kind: 'folder', path: 'Work' },
    'a/b',
    area(notes),
    folders,
  );
  assert.match(
    slash.kind === 'refused' ? slash.problem : '',
    /folder name cannot contain a slash/u,
  );
});

await test('an empty folder renames with no note to move', () => {
  assert.deepEqual(
    renamePlan(
      { kind: 'folder', path: 'Ideas' },
      'Later',
      area(notes),
      folders,
    ),
    { kind: 'rename', moves: [], folder: { from: 'Ideas', to: 'Later' } },
  );
});

await test('the field starts with the name the row shows', () => {
  assert.equal(
    renameStartName({ kind: 'note', fileId: 'a', path: 'Work/Plan.md' }),
    'Plan',
  );
  assert.equal(renameStartName({ kind: 'folder', path: 'Work/Deep' }), 'Deep');
});

await test('a note name that the server still holds for another note is refused', () => {
  // Budget took a new name on this device, and its save of that name is
  // parked, so the server still holds Work/Budget.md for it (record 0184).
  const renamed = [note('a', 'Work/Plan.md'), note('b', 'Work/Costs.md')];
  const outcome = renamePlan(
    { kind: 'note', fileId: 'a', path: 'Work/Plan.md' },
    'Budget',
    area(renamed, [{ fileId: 'b', path: 'Work/Budget.md' }]),
    folders,
  );
  assert.equal(outcome.kind, 'refused');
  // The note itself may take back the name that the server holds for it.
  assert.equal(
    renamePlan(
      { kind: 'note', fileId: 'b', path: 'Work/Costs.md' },
      'Budget',
      area(renamed, [{ fileId: 'b', path: 'Work/Budget.md' }]),
      folders,
    ).kind,
    'rename',
  );
});
