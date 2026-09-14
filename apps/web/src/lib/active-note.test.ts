import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeNoteAnchor,
  emptyActiveNote,
  withActiveNoteChange,
  withActiveNoteView,
  type ActiveNote,
} from './active-note.ts';

/** A stand-in for the editor view, because this rule never reads one. */
type Pretend = { readonly name: string };

const first: Pretend = { name: 'first' };
const second: Pretend = { name: 'second' };

await test('an open note starts with no editor and no history', () => {
  const empty = emptyActiveNote<Pretend>();
  assert.equal(empty.view, null);
  assert.equal(empty.revision, 0);
});

await test('a second note screen keeps nothing of the first one', () => {
  // The defect this proves: a value that lives longer than the note screen
  // carries the editor of the note before it into the next one. The value of
  // one screen is built here, used, and left behind.
  const opened = withActiveNoteView(emptyActiveNote<Pretend>(), first);
  const typed = withActiveNoteChange(opened);
  assert.equal(typed.view, first);

  const next = emptyActiveNote<Pretend>();
  assert.equal(next.view, null);
  assert.equal(next.revision, 0);
  assert.notEqual(next, typed);

  // The value of the first screen never changed, so nothing that a panel of
  // the second screen does can reach the editor of the first one.
  assert.equal(typed.view, first);
});

await test('a closed editor leaves no view behind', () => {
  const opened = withActiveNoteView(emptyActiveNote<Pretend>(), first);
  const closed = withActiveNoteView(opened, null);
  assert.equal(closed.view, null);
  // The count moves, so a panel reads the empty state instead of the outline
  // of the note that closed.
  assert.ok(closed.revision > opened.revision);
});

await test('the next editor replaces the one before it', () => {
  const opened = withActiveNoteView(emptyActiveNote<Pretend>(), first);
  const replaced = withActiveNoteView(opened, second);
  assert.equal(replaced.view, second);
  assert.ok(replaced.revision > opened.revision);
});

await test('a text change asks the panels to read the buffer again', () => {
  const opened = withActiveNoteView(emptyActiveNote<Pretend>(), first);
  const typed = withActiveNoteChange(opened);
  assert.equal(typed.view, first);
  assert.equal(typed.revision, opened.revision + 1);
  assert.notEqual(typed, opened);
});

await test('a text change without an editor changes nothing', () => {
  const empty: ActiveNote<Pretend> = emptyActiveNote<Pretend>();
  assert.equal(withActiveNoteChange(empty), empty);
});

await test('the caret stays inside the document', () => {
  assert.equal(activeNoteAnchor(4, 10), 4);
  assert.equal(activeNoteAnchor(0, 10), 0);
  assert.equal(activeNoteAnchor(10, 10), 10);
  assert.equal(activeNoteAnchor(-3, 10), 0);
  assert.equal(activeNoteAnchor(41, 10), 10);
  assert.equal(activeNoteAnchor(7, 0), 0);
});
