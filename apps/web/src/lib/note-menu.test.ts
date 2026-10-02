import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { actionIconNames } from './palette-items.ts';
import {
  moveNoteToTrashPaletteLabel,
  moveToTrashLabel,
  noteMenuRows,
  noteTrashRow,
} from './note-menu.ts';

/** The source tree of the web application. */
const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

/** The guide that a person reads. */
const guideRoot = fileURLToPath(
  new URL('../../../../docs/guide', import.meta.url),
);

/** Every file under one directory whose name passes the test, recursively. */
async function filesUnder(
  directory: string,
  wanted: (name: string) => boolean,
): Promise<readonly string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path, wanted)));
    else if (wanted(entry.name)) found.push(path);
  }
  return found;
}

/** The source files of the application, without the tests. */
async function sourceFiles(): Promise<readonly string[]> {
  return filesUnder(
    sourceRoot,
    (name) =>
      (name.endsWith('.ts') || name.endsWith('.tsx')) &&
      !name.endsWith('.test.ts'),
  );
}

/**
 * The screens that name a deletion for good, where Delete is the right word:
 * Trash purges a note, the workspace switcher removes a workspace, and the
 * theme settings remove an imported theme. None of them has a Trash.
 */
const permanentDeletions = new Set([
  'features/accounts/theme-settings.tsx',
  'features/trash/trash.tsx',
  'shell/workspaces.tsx',
]);

/** The files that hold the one name and the one glyph of the move. */
const trashActionSources = new Set([
  'lib/note-menu.ts',
  'lib/palette-items.ts',
  'shell/action-icons.tsx',
]);

/** A Delete label as a label, a title, a prop or a button text writes it. */
const deleteLabel =
  /(?:label|title):\s*['"`]Delete(?: note| folder| this note)?['"`]|(?:label|title)="Delete(?: note| folder)?"|>\s*Delete(?: note| folder)?\s*</u;

/** The glyph of the move to Trash, as a screen draws it. */
const trashGlyph = /actionIcon\('move-to-trash'\)|icon:\s*'move-to-trash'/u;

/** A Delete label as a page of the guide writes it. */
const guideDeleteLabel = /\*\*Delete (?:note|folder|this note)\*\*/u;

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

await test('no other source draws the glyph of the move to Trash', async () => {
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    const name = relative(sourceRoot, file);
    if (trashActionSources.has(name)) continue;
    const text = await readFile(file, 'utf8');
    if (trashGlyph.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], 'Read the row from lib/note-menu.ts.');
});

await test('no source writes Delete for a move to Trash', async () => {
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    const name = relative(sourceRoot, file);
    if (permanentDeletions.has(name)) continue;
    const text = await readFile(file, 'utf8');
    if (deleteLabel.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});

await test('the guide names the move to Trash as the application does', async () => {
  const pages = await filesUnder(guideRoot, (name) => name.endsWith('.md'));
  const offenders: string[] = [];
  for (const page of pages) {
    const text = await readFile(page, 'utf8');
    if (guideDeleteLabel.test(text)) offenders.push(relative(guideRoot, page));
  }
  assert.deepEqual(offenders, []);
});
