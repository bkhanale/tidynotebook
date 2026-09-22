/**
 * Revision graph rules.
 *
 * The tests cover roots, normal revisions, explicit merges, foreign parents,
 * repeated identifiers, submitted chains, and cycles.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGraph } from './graph.ts';
import type { RevisionInput } from './model.ts';

/** A revision with the graph members set and the rest held constant. */
function revision(
  id: string,
  fileId: string,
  parents: readonly string[],
): RevisionInput {
  return {
    id,
    fileId,
    parents,
    path: `notes/${fileId}.md`,
    deleted: false,
    content: {
      kind: 'markdown',
      document: {
        work: { kind: 'text', text: `# ${id}` },
        epoch: 1,
        observed: null,
      },
    },
    clientTime: '2026-09-05T10:00:00.000Z',
    message: null,
    restoredFrom: null,
  };
}

/** Checks that the submission is accepted. */
function accepted(
  revisions: readonly RevisionInput[],
  known: ReadonlyMap<string, string> = new Map(),
): void {
  const result = validateGraph(revisions, known);
  assert.equal(result.ok, true, 'expected the submission to pass');
}

/** Checks that the submission is rejected and names the offending file. */
function rejected(
  revisions: readonly RevisionInput[],
  known: ReadonlyMap<string, string>,
  fileId: string,
): void {
  const result = validateGraph(revisions, known);
  assert.equal(result.ok, false, 'expected the submission to fail');
  if (!result.ok) {
    assert.equal(result.error.code, 'invalid_graph');
    assert.deepEqual(result.error.fileIds, [fileId]);
  }
}

await test('an empty submission has no graph to reject', () => {
  accepted([]);
});

await test('a root revision creates a new file', () => {
  accepted([revision('r1', 'file-a', [])]);
});

await test('a root revision for a stored file is rejected', () => {
  rejected(
    [revision('r2', 'file-a', [])],
    new Map([['r1', 'file-a']]),
    'file-a',
  );
});

await test('a second root for the same file in one submission fails', () => {
  rejected(
    [revision('r1', 'file-a', []), revision('r2', 'file-a', [])],
    new Map(),
    'file-a',
  );
});

await test('one parent continues stored history', () => {
  accepted([revision('r2', 'file-a', ['r1'])], new Map([['r1', 'file-a']]));
});

await test('a chain may name earlier revisions of the same submission', () => {
  accepted([
    revision('r1', 'file-a', []),
    revision('r2', 'file-a', ['r1']),
    revision('r3', 'file-a', ['r2']),
  ]);
});

await test('one changeset may carry a revision for each file', () => {
  accepted([
    revision('r1', 'file-a', []),
    revision('r2', 'file-b', []),
    revision('r3', 'file-a', ['r1']),
  ]);
});

await test('an explicit merge names two parents', () => {
  accepted(
    [revision('r3', 'file-a', ['r1', 'r2'])],
    new Map([
      ['r1', 'file-a'],
      ['r2', 'file-a'],
    ]),
  );
});

await test('a merge of a submitted revision and a stored branch passes', () => {
  accepted(
    [revision('r2', 'file-a', ['r1']), revision('r3', 'file-a', ['r2', 'b1'])],
    new Map([
      ['r1', 'file-a'],
      ['b1', 'file-a'],
    ]),
  );
});

await test('more than two parents are rejected', () => {
  rejected(
    [revision('r4', 'file-a', ['r1', 'r2', 'r3'])],
    new Map([
      ['r1', 'file-a'],
      ['r2', 'file-a'],
      ['r3', 'file-a'],
    ]),
    'file-a',
  );
});

await test('the same parent twice is rejected', () => {
  rejected(
    [revision('r2', 'file-a', ['r1', 'r1'])],
    new Map([['r1', 'file-a']]),
    'file-a',
  );
});

await test('an unknown parent is rejected', () => {
  rejected([revision('r2', 'file-a', ['missing'])], new Map(), 'file-a');
});

await test('a parent of another file is rejected', () => {
  rejected(
    [revision('r2', 'file-a', ['r1'])],
    new Map([['r1', 'file-b']]),
    'file-a',
  );
});

await test('a merge parent of another file is rejected', () => {
  rejected(
    [revision('r3', 'file-a', ['r1', 'r2'])],
    new Map([
      ['r1', 'file-a'],
      ['r2', 'file-b'],
    ]),
    'file-a',
  );
});

await test('a repeated identifier in the submission is rejected', () => {
  rejected(
    [revision('r1', 'file-a', []), revision('r1', 'file-a', ['r1'])],
    new Map(),
    'file-a',
  );
});

await test('an identifier that storage already holds is rejected', () => {
  rejected(
    [revision('r1', 'file-a', [])],
    new Map([['r1', 'file-a']]),
    'file-a',
  );
});

await test('a later revision must continue the submitted chain', () => {
  rejected(
    [revision('r2', 'file-a', ['r1']), revision('r3', 'file-a', ['r1'])],
    new Map([['r1', 'file-a']]),
    'file-a',
  );
});

await test('a cycle cannot pass the parent rules', () => {
  // Two revisions that name each other. The first one is inspected before its
  // parent exists, so the submission is rejected.
  rejected(
    [revision('r1', 'file-a', ['r2']), revision('r2', 'file-a', ['r1'])],
    new Map(),
    'file-a',
  );
  // A revision that names itself fails for the same reason.
  rejected([revision('r1', 'file-a', ['r1'])], new Map(), 'file-a');
});
