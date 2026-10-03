import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openRename,
  renameStep,
  type RenameEvent,
  type RenameField,
} from './tree-rename-field.ts';

/** Runs some events and collects the effects. */
function run(
  events: readonly RenameEvent[],
  start: RenameField = openRename('note:a', 'Plan'),
): { readonly field: RenameField; readonly effects: readonly string[] } {
  let field = start;
  const effects: string[] = [];
  for (const event of events) {
    const step = renameStep(field, event);
    field = step.field;
    effects.push(step.effect);
  }
  return { field, effects };
}

await test('Escape gives the name back and the blur after it keeps nothing', () => {
  // The review of the merged branch: Escape gave the focus to the row, the
  // field blurred, and the blur kept the words that Escape gave up.
  const { field, effects } = run([
    { kind: 'type', value: 'Roadmap' },
    { kind: 'escape' },
    { kind: 'blur' },
  ]);
  assert.deepEqual(effects, ['none', 'give-back', 'none']);
  assert.equal(field.phase, 'closed');
});

await test('Enter keeps the name once and gives the focus back to the row', () => {
  const { field, effects } = run([
    { kind: 'type', value: 'Roadmap' },
    { kind: 'enter' },
    { kind: 'kept' },
  ]);
  assert.deepEqual(effects, ['none', 'keep', 'give-back']);
  assert.equal(field.value, 'Roadmap');
  assert.equal(field.phase, 'closed');
});

await test('a move away keeps the name and leaves the focus where it went', () => {
  // The second review: a person renamed a row, clicked into the editor, and
  // the kept name took the caret back to the row.
  const { field, effects } = run([
    { kind: 'type', value: 'Roadmap' },
    { kind: 'blur' },
    { kind: 'kept' },
  ]);
  assert.deepEqual(effects, ['none', 'keep', 'none']);
  assert.equal(field.phase, 'closed');
});

await test('a move away while the name is being kept writes nothing more', () => {
  const { field, effects } = run([
    { kind: 'type', value: 'Roadmap' },
    { kind: 'enter' },
    { kind: 'blur' },
    { kind: 'kept' },
  ]);
  assert.deepEqual(effects, ['none', 'keep', 'none', 'none']);
  assert.equal(field.phase, 'closed');
});

await test('a refused name after a move away gives the old name back', () => {
  // The second review: the field opened again with no focus, and the tree
  // took no key while it stood open.
  const { field, effects } = run([
    { kind: 'type', value: 'Plan 2' },
    { kind: 'blur' },
    { kind: 'refused' },
  ]);
  assert.deepEqual(effects, ['none', 'keep', 'none']);
  assert.equal(field.phase, 'closed');
  const late = run([
    { kind: 'type', value: 'Plan 2' },
    { kind: 'enter' },
    { kind: 'blur' },
    { kind: 'refused' },
  ]);
  assert.equal(late.field.phase, 'closed');
});

await test('a refused name opens the field again with the words of the person', () => {
  const { field, effects } = run([
    { kind: 'type', value: 'a/b' },
    { kind: 'enter' },
    { kind: 'refused' },
    { kind: 'type', value: 'a-b' },
    { kind: 'enter' },
  ]);
  assert.deepEqual(effects, ['none', 'keep', 'none', 'none', 'keep']);
  assert.equal(field.value, 'a-b');
  assert.equal(field.phase, 'keeping');
  assert.equal(field.focusLeft, false);
});

await test('words typed while the name is being kept do not change it', () => {
  const { field } = run([
    { kind: 'enter' },
    { kind: 'type', value: 'late' },
    { kind: 'escape' },
  ]);
  assert.equal(field.value, 'Plan');
  assert.equal(field.phase, 'keeping');
});
