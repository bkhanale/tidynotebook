import assert from 'node:assert/strict';
import test from 'node:test';
import { formatActionOf, formatActions, outsideTable } from '@notesapp/editor';
import { controlStripClassName } from '@notesapp/ui';
import { actionIconNames } from './palette-items.ts';
import { noteColumnClassName } from './note-column.ts';
import {
  formatPaletteRows,
  formatToolbar,
  formatToolbarClassName,
  formatToolbarColumnClassName,
  formatToolbarFrameClassName,
  formatToolGroupClassName,
  formatToolTitle,
  tableTools,
  toolApplies,
  toolbarFocusTarget,
  toolbarGroups,
} from './format-toolbar.ts';

/** The caret outside a table, in a body row, and in the header row. */
const outside = outsideTable;
const inside = { table: true, bodyRow: true, columns: 2 } as const;
const inHeader = { table: true, bodyRow: false, columns: 2 } as const;
type Context = typeof outside;

/** Every format action that the row reaches, in the order of the row. */
const rowActions = formatToolbar.flat().map((tool) => tool.id);

await test('the row holds the tools that issue 153 asks for, in four groups', () => {
  assert.deepEqual(
    formatToolbar.map((group) => group.map((tool) => tool.id)),
    [
      ['heading-1', 'heading-2', 'heading-3'],
      ['bold', 'italic', 'strikethrough', 'inline-code', 'link'],
      ['bullet-list', 'ordered-list', 'task-list', 'quote'],
      ['table'],
    ],
  );
});

await test('every tool is a format action of the editor, reached once', () => {
  const known = new Set(formatActions.map((action) => action.id));
  const all = [...rowActions, ...tableTools.map((tool) => tool.id)];
  for (const id of all) assert.ok(known.has(id), `${id} is unknown`);
  assert.equal(new Set(all).size, all.length);
  // Every format action is a tool except the heading levels four to six,
  // which the keys reach.
  assert.equal(all.length, formatActions.length - 3);
});

await test('every tool draws a glyph of its own', () => {
  const glyphs = new Set<string>(actionIconNames);
  const icons = toolbarGroups(inside)
    .flat()
    .map((tool) => tool.icon);
  for (const icon of icons) assert.ok(glyphs.has(icon), `${icon} is no glyph`);
  assert.equal(new Set(icons).size, icons.length);
});

await test('the palette offers every tool of the row and nothing else', () => {
  const rows = formatPaletteRows(outside);
  assert.deepEqual(
    rows.map((row) => row.action),
    rowActions,
  );
  for (const row of rows) {
    const action = formatActionOf(row.action);
    assert.equal(row.label, action.label);
    assert.equal(row.keys, action.keys ?? undefined);
    assert.equal(row.id, `format-${row.action}`);
    assert.ok(row.keywords.startsWith('format markdown'));
  }
  assert.equal(rows.find((row) => row.action === 'table')?.keys, undefined);
});

await test('a tool title names the keys of the device', () => {
  assert.equal(formatToolTitle('Bold', ['⌘', 'B'], true), 'Bold (⌘B)');
  assert.equal(
    formatToolTitle('Bold', ['Ctrl', 'B'], false),
    'Bold (Ctrl + B)',
  );
  assert.equal(formatToolTitle('Table', [], false), 'Table');
});

await test('the arrow keys move inside the row and wrap at both ends', () => {
  assert.equal(toolbarFocusTarget('ArrowRight', 0, 7), 1);
  assert.equal(toolbarFocusTarget('ArrowRight', 6, 7), 0);
  assert.equal(toolbarFocusTarget('ArrowLeft', 0, 7), 6);
  assert.equal(toolbarFocusTarget('Home', 4, 7), 0);
  assert.equal(toolbarFocusTarget('End', 1, 7), 6);
  assert.equal(toolbarFocusTarget('Enter', 1, 7), null);
  assert.equal(toolbarFocusTarget('ArrowRight', 0, 0), null);
});

await test('the row stands on the measure of the note, above a divider', () => {
  const frame = formatToolbarFrameClassName().split(' ');
  assert.ok(frame.includes('border-b'));
  assert.ok(frame.includes('border-edge-line'));
  // The footer uses the same inline padding, so the row, the text and the
  // word count start on one line.
  assert.ok(frame.includes('px-2'));
  const column = formatToolbarColumnClassName().split(' ');
  // Decision 0055: the one measure of the note, centred.
  for (const name of ['mx-auto', 'w-full', 'max-w-note']) {
    assert.ok(noteColumnClassName().split(' ').includes(name));
    assert.ok(column.includes(name), `the column lacks ${name}`);
  }
});

await test('the row scrolls sideways and never moves a tool out of it', () => {
  // A phone scrolls the row instead of hiding tools in a menu, so a menu
  // never covers the text that a person selected.
  const row = formatToolbarClassName();
  assert.ok(row.startsWith(controlStripClassName()));
  assert.ok(!row.split(' ').includes('flex-wrap'));
  const group = formatToolGroupClassName().split(' ');
  assert.ok(group.includes('shrink-0'));
  assert.ok(
    !group.some((name) => name === 'hidden' || name.endsWith(':hidden')),
  );
});

await test('the table tools join the end of the row inside a table only', () => {
  // Record 0095. The tools before them never move.
  assert.deepEqual(toolbarGroups(outside), formatToolbar);
  assert.deepEqual(toolbarGroups(inside), [...formatToolbar, tableTools]);
  assert.deepEqual(
    tableTools.map((tool) => tool.id),
    [
      'table-add-row',
      'table-add-column',
      'table-remove-row',
      'table-remove-column',
    ],
  );
});

await test('a block tool does not apply inside a table', () => {
  const applies = (id: string, context: Context): boolean => {
    const tool = toolbarGroups(inside)
      .flat()
      .find((candidate) => candidate.id === id);
    assert.ok(tool !== undefined, id);
    return tool !== undefined && toolApplies(tool, context);
  };
  for (const id of ['heading-1', 'bullet-list', 'quote', 'table']) {
    assert.equal(applies(id, outside), true, id);
    assert.equal(applies(id, inside), false, id);
  }
  for (const id of ['bold', 'link', 'inline-code'])
    assert.equal(applies(id, inside), true, id);
  assert.equal(applies('table-add-row', outside), false);
  assert.equal(applies('table-add-row', inside), true);
});

await test('the palette offers the tools that apply where the caret stands', () => {
  const ids = (context: Context): readonly string[] =>
    formatPaletteRows(context).map((row) => row.action);
  assert.ok(!ids(outside).includes('table-add-row'));
  assert.ok(ids(inside).includes('table-add-row'));
  assert.ok(ids(inside).includes('bold'));
  assert.ok(!ids(inside).includes('heading-1'));
  assert.ok(!ids(inside).includes('table'));
});

await test('the header row and the last column are never offered for removal', () => {
  const tool = (id: string) =>
    tableTools.find((candidate) => candidate.id === id);
  const removeRow = tool('table-remove-row');
  const removeColumn = tool('table-remove-column');
  assert.ok(removeRow !== undefined && removeColumn !== undefined);
  if (removeRow === undefined || removeColumn === undefined) return;
  assert.equal(toolApplies(removeRow, inHeader), false);
  assert.equal(toolApplies(removeRow, inside), true);
  assert.equal(toolApplies(removeColumn, { ...inside, columns: 1 }), false);
  assert.equal(toolApplies(removeColumn, inside), true);
  assert.ok(
    !formatPaletteRows(inHeader)
      .map((row) => row.action)
      .includes('table-remove-row'),
  );
});
