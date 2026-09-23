/**
 * Ordered list numbering checks (record 0089).
 *
 * Each test builds a real `EditorState` with the note language, the numbering
 * filter, and the CodeMirror history, then applies the transaction that one
 * action of a person dispatches. The filter runs inside `state.update`, so the
 * result is exactly what the editor holds after the action. No DOM is needed.
 *
 * The notation marks the cursor inside the source text with `‸`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { history, undo } from '@codemirror/commands';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { editingTransaction } from './commands.ts';
import {
  continueBlockSpec,
  indentListSpec,
  outdentListSpec,
  toggleListSpec,
} from './keymaps.ts';
import { noteMarkdown, parsedWhole } from './language.ts';
import { previewStructureOf } from './live-preview.ts';
import { orderedListNumbering } from './list-numbering.ts';

/** Builds a parsed state with the numbering, from text that marks a cursor. */
function stateOf(source: string): EditorState {
  const cursor = source.indexOf('‸');
  const doc = source.replace('‸', '');
  return parsedWhole(
    EditorState.create({
      doc,
      selection: { anchor: cursor === -1 ? 0 : cursor },
      // No two transactions share one undo step here, so a test of the undo
      // step proves that the edit and its numbers are one transaction.
      extensions: [
        noteMarkdown(),
        orderedListNumbering(),
        history({ newGroupDelay: 0 }),
      ],
    }),
  );
}

/** Applies one spec and returns the new state. */
function apply(state: EditorState, spec: TransactionSpec | null): EditorState {
  assert.notEqual(spec, null, 'the command declined');
  return state.update(spec ?? {}).state;
}

/** Applies one command of this package, as its key binding dispatches it. */
function command(
  source: string,
  build: (state: EditorState) => TransactionSpec | null,
): string {
  const state = stateOf(source);
  const spec = build(state);
  return apply(
    state,
    spec === null ? null : editingTransaction(spec),
  ).doc.toString();
}

/** Replaces one range of the source, as one edit of a person. */
function edit(
  source: string,
  from: number,
  to: number,
  insert: string,
  userEvent = 'input',
): string {
  const state = stateOf(source);
  return apply(state, {
    changes: { from, to, insert },
    userEvent,
  }).doc.toString();
}

await test('Enter inside a list moves the numbers of the items below it', () => {
  assert.equal(
    command('1. one‸\n2. two\n3. three', continueBlockSpec),
    '1. one\n2. \n3. two\n4. three',
  );
});

await test('a pasted item takes its place in the sequence', () => {
  const source = '1. one\n2. two';
  assert.equal(
    edit(
      source,
      source.indexOf('2.'),
      source.indexOf('2.'),
      '1. new\n',
      'input.paste',
    ),
    '1. one\n2. new\n3. two',
  );
});

await test('a deleted item closes the gap it leaves', () => {
  const source = '1. one\n2. two\n3. three';
  const from = source.indexOf('2.');
  assert.equal(
    edit(source, from, from + '2. two\n'.length, '', 'delete.backward'),
    '1. one\n2. three',
  );
});

await test('a list keeps its start when its first item goes', () => {
  assert.equal(
    edit('1. one\n2. two\n3. three', 0, '1. one\n'.length, '', 'delete.cut'),
    '1. two\n2. three',
  );
  assert.equal(
    edit('4. one\n5. two\n6. three', 0, '4. one\n'.length, '', 'delete.cut'),
    '4. two\n5. three',
  );
});

await test('a list keeps a start other than one', () => {
  assert.equal(
    command('4. one‸\n5. two', continueBlockSpec),
    '4. one\n5. \n6. two',
  );
});

await test('a new first number is the new start of the list', () => {
  assert.equal(
    edit('1. one\n2. two\n3. three', 0, 1, '7', 'input.type'),
    '7. one\n8. two\n9. three',
  );
});

await test('an indented item starts a nested list of its own', () => {
  assert.equal(
    command('1. one\n2. two‸\n3. three', indentListSpec),
    '1. one\n   1. two\n2. three',
  );
  // A second indent joins the nested list above it and counts on from there.
  assert.equal(
    command('1. one\n   1. two\n2. three‸\n3. four', indentListSpec),
    '1. one\n   1. two\n   2. three\n2. four',
  );
});

await test('an outdented item joins the list of its parent', () => {
  assert.equal(
    command('1. one\n   1. two\n   2. three‸\n2. four', outdentListSpec),
    '1. one\n   1. two\n2. three\n3. four',
  );
  // The items that stay nested start their own list again at one.
  assert.equal(
    command(
      '1. one\n   1. two‸\n   2. three\n   3. four\n2. five',
      outdentListSpec,
    ),
    '1. one\n2. two\n   1. three\n   2. four\n3. five',
  );
});

await test('a nested list keeps its own count and leaves its parent alone', () => {
  assert.equal(
    command('1. one\n   1. two‸\n2. three', continueBlockSpec),
    '1. one\n   1. two\n   2. \n2. three',
  );
  assert.deepEqual(
    previewStructureOf('1. one\n   1. two\n   2. \n2. three').map((node) =>
      node.kind === 'list-item' ? node.value : null,
    ),
    [1, 1, 2, 2],
  );
});

await test('a marker that grows moves the children of its item with it', () => {
  // The defect this guards: `9. ` holds its text at the third column and
  // `10. ` at the fourth, so a child at three spaces left the item and
  // became a list of its own.
  const items = Array.from(
    { length: 9 },
    (_, index) => `${String(index + 1)}. item`,
  );
  const source = `${items.join('\n')}\n   - child`;
  const cursor = source.indexOf('\n');
  const result = command(
    `${source.slice(0, cursor)}‸${source.slice(cursor)}`,
    continueBlockSpec,
  );
  assert.ok(result.endsWith('\n10. item\n    - child'), result);
  const structure = previewStructureOf(result);
  assert.deepEqual(structure[structure.length - 1], {
    kind: 'list-item',
    depth: 2,
    ordered: false,
    value: null,
  });
});

await test('a marker that shrinks moves the children of its item back', () => {
  const items = Array.from(
    { length: 9 },
    (_, index) => `${String(index + 1)}. item`,
  );
  const source = `${items.join('\n')}\n10. last\n    - child`;
  const result = edit(source, 0, '1. item\n'.length, '', 'delete.backward');
  assert.ok(result.endsWith('\n9. last\n   - child'), result);
});

await test('a list inside a quote keeps its sequence', () => {
  const source = '> 1. one\n> 2. two\n> 3. three';
  const from = source.indexOf('> 2.');
  assert.equal(
    edit(source, from, from + '> 2. two\n'.length, '', 'delete.backward'),
    '> 1. one\n> 2. three',
  );
});

await test('toggling an ordered line inside a list numbers it in place', () => {
  assert.equal(
    command('1. one\n2. two\nthree‸', (state) =>
      toggleListSpec(state, 'ordered'),
    ),
    '1. one\n2. two\n3. three',
  );
});

await test('typing inside the text of an item writes no numbers', () => {
  // The source may hold a lazy sequence that a reader counts the same way.
  // An edit that cannot change the shape of the list leaves it as written.
  const source = '1. one\n1. two';
  assert.equal(
    edit(source, source.length, source.length, 's', 'input.type'),
    '1. one\n1. twos',
  );
});

await test('a list that the edit did not touch keeps its numbers', () => {
  const source = '1. one‸\n2. two\n\nText.\n\n1. far\n1. away';
  assert.equal(
    command(source, continueBlockSpec),
    '1. one\n2. \n3. two\n\nText.\n\n1. far\n1. away',
  );
});

await test('a remote change and a composition are never renumbered', () => {
  const source = '1. one\n2. two\n3. three';
  const from = source.indexOf('2.');
  const state = stateOf(source);
  // Work of another device reaches the view with no user event.
  const remote = state.update({
    changes: { from, to: from + '2. two\n'.length, insert: '' },
  }).state;
  assert.equal(remote.doc.toString(), '1. one\n3. three');
  const composed = state.update({
    changes: { from, to: from + '2. two\n'.length, insert: '' },
    userEvent: 'input.type.compose',
  }).state;
  assert.equal(composed.doc.toString(), '1. one\n3. three');
});

await test('one undo removes an edit and the numbers it wrote', () => {
  const source = '1. one‸\n2. two\n3. three';
  const state = stateOf(source);
  const spec = continueBlockSpec(state);
  const after = apply(state, spec === null ? null : editingTransaction(spec));
  assert.equal(after.doc.toString(), '1. one\n2. \n3. two\n4. three');
  let undone: EditorState | null = null;
  assert.ok(
    undo({
      state: after,
      dispatch: (transaction) => {
        undone = transaction.state;
      },
    }),
  );
  assert.equal((undone ?? after).doc.toString(), '1. one\n2. two\n3. three');
});
