import assert from 'node:assert/strict';
import test from 'node:test';
import { actionIconNames } from './palette-items.ts';
import {
  moveNoteToTrashPaletteLabel,
  moveToTrashLabel,
  noteMenuRows,
  noteTrashRow,
} from './note-menu.ts';

/** Every row the menu can show, whatever the open note offers. */
const everyRow = noteMenuRows({ canMove: true, canPublish: true });

await test('History and Publish are rows of the note menu', () => {
  // Decision 0069. Neither one takes a button of the header, so a phone keeps
  // that width for the name of the note.
  const ids = everyRow.map((row) => row.id);
  assert.ok(ids.includes('history'));
  assert.ok(ids.includes('publish'));
  assert.equal(ids[0], 'history');
  assert.equal(ids[1], 'publish');
});

await test('the menu groups its rows by what they act on', () => {
  assert.deepEqual(
    everyRow.map((row) => row.id),
    [
      'history',
      'publish',
      'rename',
      'move',
      'duplicate',
      'attach-image',
      'export',
    ],
  );
});

await test('a row with no dialog behind it is absent', () => {
  const ids = noteMenuRows({ canMove: false, canPublish: false }).map(
    (row) => row.id,
  );
  assert.ok(!ids.includes('move'));
  assert.ok(!ids.includes('publish'));
  // Every other row still stands.
  assert.deepEqual(ids, [
    'history',
    'rename',
    'duplicate',
    'attach-image',
    'export',
  ]);
});

await test('Move to Trash is not one of the rows above the separator', () => {
  assert.ok(!everyRow.some((row) => row.id === noteTrashRow.id));
  assert.equal(noteTrashRow.label, 'Move to Trash');
});

await test('every row names a glyph the application draws', () => {
  for (const row of [...everyRow, noteTrashRow])
    assert.ok(
      actionIconNames.includes(row.icon),
      `${row.id} names no glyph of the application`,
    );
});

await test('every label is one term in sentence case', () => {
  for (const row of [...everyRow, noteTrashRow]) {
    assert.match(row.label, /^[A-Z]/);
    assert.ok(!row.label.endsWith('.'));
  }
});

await test('the move to Trash has one name on every surface', () => {
  // Issue 245: the tree said Delete, the note menu said Move to Trash, and in
  // Trash Delete removes a note for good. One word named two actions.
  assert.equal(noteTrashRow.label, moveToTrashLabel);
  assert.equal(noteTrashRow.icon, 'move-to-trash');
  assert.ok(moveNoteToTrashPaletteLabel.startsWith('Move '));
  assert.ok(moveNoteToTrashPaletteLabel.endsWith(' to Trash'));
});

await test('a note row of the tree offers the note menu with Open and Copy link', () => {
  // Record 0164: the menu of a tree row had one row, and one table holds the
  // rows of the tree and of the header, so their words cannot drift.
  assert.deepEqual(
    noteMenuRows({ canMove: true, canPublish: true, surface: 'tree' }).map(
      (row) => row.id,
    ),
    [
      'open',
      'history',
      'publish',
      'rename',
      'move',
      'duplicate',
      'copy-link',
      'export',
    ],
  );
});

await test('a row the two menus share reads the same words in both', () => {
  const tree = noteMenuRows({
    canMove: true,
    canPublish: true,
    surface: 'tree',
  });
  for (const row of tree) {
    const header = everyRow.find((entry) => entry.id === row.id);
    if (header !== undefined) assert.deepEqual(header, row);
  }
});
