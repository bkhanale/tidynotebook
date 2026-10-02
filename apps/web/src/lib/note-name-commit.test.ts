import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitNoteName,
  nameStillPending,
  noteNameKey,
} from './note-name-commit.ts';

const notes = [
  { fileId: 'original', path: 'Work/Plan.md' },
  { fileId: 'copy', path: 'Work/Plan copy.md' },
];

await test('a new name renames the note in its folder', () => {
  assert.deepEqual(
    commitNoteName({
      typed: 'Plan for May',
      folder: 'Work',
      currentPath: 'Work/Plan copy.md',
      notes,
      fileId: 'copy',
    }),
    { kind: 'rename', path: 'Work/Plan for May.md', name: 'Plan for May' },
  );
});

await test('the name of another note is refused and nothing is renamed', () => {
  // The duplicate of Plan passes through the name Plan while a person
  // deletes the word copy. Only the name they keep is checked.
  const outcome = commitNoteName({
    typed: 'Plan',
    folder: 'Work',
    currentPath: 'Work/Plan copy.md',
    notes,
    fileId: 'copy',
  });
  assert.equal(outcome.kind, 'refused');
});

await test('the same name with edge spaces and a suffix changes nothing', () => {
  assert.deepEqual(
    commitNoteName({
      typed: '  Plan copy.md ',
      folder: 'Work',
      currentPath: 'Work/Plan copy.md',
      notes,
      fileId: 'copy',
    }),
    { kind: 'unchanged', name: 'Plan copy' },
  );
});

await test('an empty name and a slash are refused', () => {
  const input = {
    folder: '',
    currentPath: 'Plan.md',
    notes,
    fileId: 'original',
  };
  assert.deepEqual(commitNoteName({ ...input, typed: '  ' }), {
    kind: 'refused',
    problem: 'Type a note name.',
  });
  assert.equal(commitNoteName({ ...input, typed: 'a/b' }).kind, 'refused');
});

await test('a change of case alone renames the note', () => {
  assert.deepEqual(
    commitNoteName({
      typed: 'plan',
      folder: 'Work',
      currentPath: 'Work/Plan.md',
      notes,
      fileId: 'original',
    }),
    { kind: 'rename', path: 'Work/plan.md', name: 'plan' },
  );
});

await test('Enter keeps the name and Escape gives it up', () => {
  assert.equal(noteNameKey('Enter', false), 'commit');
  assert.equal(noteNameKey('Escape', false), 'revert');
  assert.equal(noteNameKey('a', false), null);
  // Enter that ends an IME composition writes the composed characters.
  assert.equal(noteNameKey('Enter', true), null);
});

await test('a name that moved while a draft wrote stays pending', () => {
  // The review of the merged branch: a draft write that started with the
  // old path cleared the pending name, and the next queue read put the old
  // path back over the name of the heading.
  assert.equal(nameStillPending('New note.md', { current: 'Plan.md' }), true);
  assert.equal(nameStillPending('Plan.md', { current: 'Plan.md' }), false);
});
