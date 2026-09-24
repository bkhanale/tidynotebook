import assert from 'node:assert/strict';
import test from 'node:test';
import { formatActionOf, formatActions } from '@notesapp/editor';
import { actionIconNames } from './palette-items.ts';
import { noteColumnClassName } from './note-column.ts';
import {
  formatPaletteRows,
  formatToolbar,
  formatToolbarClassName,
  formatToolbarFrameClassName,
  formatToolClassName,
  formatToolGroupClassName,
  formatToolTitle,
  moreFormattingClassName,
  overflowTools,
  toolbarFocusTarget,
} from './format-toolbar.ts';

/** Every format action that the row reaches, in the order of the row. */
const rowActions = formatToolbar
  .flat()
  .flatMap((tool) => (tool.kind === 'menu' ? tool.actions : [tool.id]));

await test('the row holds the tools that issue 153 asks for, in four groups', () => {
  assert.deepEqual(
    formatToolbar.map((group) => group.map((tool) => tool.id)),
    [
      ['heading'],
      ['bold', 'italic', 'strikethrough', 'inline-code', 'link'],
      ['bullet-list', 'ordered-list', 'task-list', 'quote'],
      ['table'],
    ],
  );
  assert.deepEqual(rowActions.slice(0, 3), [
    'heading-1',
    'heading-2',
    'heading-3',
  ]);
});

await test('every tool is a format action of the editor, reached once', () => {
  const known = new Set(formatActions.map((action) => action.id));
  for (const id of rowActions) assert.ok(known.has(id), `${id} is unknown`);
  assert.equal(new Set(rowActions).size, rowActions.length);
});

await test('every tool draws a named glyph', () => {
  const glyphs = new Set<string>(actionIconNames);
  for (const tool of formatToolbar.flat())
    assert.ok(glyphs.has(tool.icon), `${tool.id} has no glyph`);
});

await test('a phone keeps six tools in the row and moves the rest to More', () => {
  // Six tools and the More menu are seven targets of 44 px, which is the
  // width of a phone of 360 px inside its gutter.
  const narrow = formatToolbar.flat().filter((tool) => tool.narrow);
  assert.deepEqual(
    narrow.map((tool) => tool.id),
    ['heading', 'bold', 'italic', 'link', 'bullet-list', 'task-list'],
  );
  assert.deepEqual(
    overflowTools().map((tool) => tool.id),
    ['strikethrough', 'inline-code', 'ordered-list', 'quote', 'table'],
  );
  // No menu moves into More, because a menu inside a menu is out of reach
  // for many people.
  assert.ok(
    formatToolbar.flat().every((tool) => tool.kind === 'action' || tool.narrow),
  );
});

await test('the palette offers every tool of the row and nothing else', () => {
  const rows = formatPaletteRows();
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
  const table = rows.find((row) => row.action === 'table');
  assert.equal(table?.keys, undefined);
  assert.equal(rows.find((row) => row.action === 'heading-2')?.icon, 'heading');
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
  const row = formatToolbarClassName().split(' ');
  for (const name of noteColumnClassName().split(' ').slice(0, 3))
    assert.ok(row.includes(name), `the row lacks ${name}`);
});

await test('a phone hides the tools of More and shows the menu alone', () => {
  const [heading, marks, blocks, table] = formatToolbar;
  assert.ok(heading !== undefined && marks !== undefined);
  assert.ok(blocks !== undefined && table !== undefined);
  assert.equal(
    formatToolGroupClassName(table),
    'hidden sm:flex items-center md:gap-1',
  );
  assert.equal(formatToolGroupClassName(marks), 'flex items-center md:gap-1');
  for (const tool of formatToolbar.flat())
    assert.equal(
      formatToolClassName(tool),
      tool.narrow ? 'contents' : 'hidden sm:contents',
    );
  assert.equal(moreFormattingClassName, 'sm:hidden');
});
