import assert from 'node:assert/strict';
import test from 'node:test';
import type { NoteSummary } from './note-list.ts';
import { folderMoves, moveProblem } from './folder-moves.ts';

const note = (fileId: string, path: string): NoteSummary => ({
  fileId,
  path,
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
