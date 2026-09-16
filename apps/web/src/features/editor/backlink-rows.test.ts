import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';
import { backlinksState, type BacklinkRow } from './backlink-rows.ts';

/** One row, as either answer reports it. */
function row(fileId: string, path: string): BacklinkRow {
  return { fileId, path };
}

test('no answer at all is a failed read and never an empty list', () => {
  const state = backlinksState(null, null);
  strictEqual(state.kind, 'failed');
});

test('two empty answers are an empty read', () => {
  const state = backlinksState([], []);
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  deepStrictEqual(state.rows, []);
  strictEqual(state.partial, false);
});

test('a device answer with no server answer is partial', () => {
  const state = backlinksState(null, [row('a', 'plan.md')]);
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  deepStrictEqual(
    state.rows.map((item) => item.path),
    ['plan.md'],
  );
  strictEqual(state.partial, true);
});

test('an empty device answer with no server answer is still partial', () => {
  const state = backlinksState(null, []);
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  deepStrictEqual(state.rows, []);
  strictEqual(state.partial, true);
});

test('a server answer with no device answer is whole', () => {
  const state = backlinksState([row('a', 'plan.md')], null);
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  strictEqual(state.partial, false);
});

test('one note is listed once, whichever answer holds it', () => {
  const state = backlinksState(
    [row('a', 'plan.md'), row('b', 'diary.md')],
    [row('a', 'plan.md'), row('c', 'draft.md')],
  );
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  deepStrictEqual(
    state.rows.map((item) => item.path),
    ['diary.md', 'draft.md', 'plan.md'],
  );
});

test('the device states the newer path of a note', () => {
  const state = backlinksState(
    [row('a', 'old name.md')],
    [row('a', 'new name.md')],
  );
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  deepStrictEqual(
    state.rows.map((item) => item.path),
    ['new name.md'],
  );
});
