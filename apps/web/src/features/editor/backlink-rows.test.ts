import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';
import {
  backlinksEmptyMessage,
  backlinksState,
  serverBacklinkRead,
  serverBacklinkRows,
  type BacklinkRow,
} from './backlink-rows.ts';

/** One row, as either answer reports it. */
function row(fileId: string, path: string): BacklinkRow {
  return { fileId, path };
}

await test('no answer at all is a failed read and never an empty list', () => {
  const state = backlinksState(null, null);
  strictEqual(state.kind, 'failed');
});

await test('two empty answers are an empty read', () => {
  const state = backlinksState([], []);
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  deepStrictEqual(state.rows, []);
  strictEqual(state.partial, false);
});

await test('a device answer with no server answer is partial', () => {
  const state = backlinksState(null, [row('a', 'plan.md')]);
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  deepStrictEqual(
    state.rows.map((item) => item.path),
    ['plan.md'],
  );
  strictEqual(state.partial, true);
});

await test('an empty device answer with no server answer is still partial', () => {
  const state = backlinksState(null, []);
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  deepStrictEqual(state.rows, []);
  strictEqual(state.partial, true);
});

await test('a server answer with no device answer is whole', () => {
  const state = backlinksState([row('a', 'plan.md')], null);
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  strictEqual(state.partial, false);
});

await test('one note is listed once, whichever answer holds it', () => {
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

await test('the device states the newer path of a note', () => {
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

await test('a note the server does not hold asks nothing and is empty', () => {
  // The defect this covers: a new note asked the server for its links before
  // its first save, the server answered not found, and an online person read
  // that the full list needs a connection.
  strictEqual(
    serverBacklinkRead({ known: true, localOnly: true, online: true }),
    'empty',
  );
  const state = backlinksState([], []);
  strictEqual(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  strictEqual(state.partial, false);
  strictEqual(
    backlinksEmptyMessage(state.partial, true),
    'No notes link here. Add a link to this note from another note.',
  );
});

await test('the server is asked only for a note it holds, while online', () => {
  strictEqual(
    serverBacklinkRead({ known: true, localOnly: false, online: true }),
    'ask',
  );
  strictEqual(
    serverBacklinkRead({ known: true, localOnly: false, online: false }),
    'none',
  );
  // A note made on this device has no server link offline either.
  strictEqual(
    serverBacklinkRead({ known: true, localOnly: true, online: false }),
    'empty',
  );
  // Until the note list answers, the panel does not guess.
  strictEqual(
    serverBacklinkRead({ known: false, localOnly: false, online: true }),
    'wait',
  );
});

await test('not found from the server is an empty list, not a failure', () => {
  deepStrictEqual(serverBacklinkRows({ status: 404, rows: null }), []);
  strictEqual(serverBacklinkRows({ status: 500, rows: null }), null);
  strictEqual(serverBacklinkRows({ status: 0, rows: null }), null);
  deepStrictEqual(
    serverBacklinkRows({ status: 200, rows: [row('a', 'a.md')] }),
    [row('a', 'a.md')],
  );
});

await test('an empty partial list names the missing part truly', () => {
  strictEqual(
    backlinksEmptyMessage(true, false),
    'This device finds no link to this note. The full list needs a connection.',
  );
  // Online, the cause is not the connection.
  strictEqual(
    backlinksEmptyMessage(true, true),
    'This device finds no link to this note. The server did not answer.',
  );
});
