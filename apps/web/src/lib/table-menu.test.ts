import assert from 'node:assert/strict';
import test from 'node:test';
import { formatActions, outsideTable } from '@notesapp/editor';
import { tableActionRows, tableMenuEntries } from './table-menu.ts';

/** A cell in a body row of a table of two columns, and one in its header. */
const body = {
  table: true,
  bodyRow: true,
  row: 1,
  rows: 3,
  column: 0,
  columns: 2,
  align: null,
} as const;
const header = { ...body, bodyRow: false, row: 0 } as const;

await test('every table action of the editor is in the one list, once', () => {
  const editor = formatActions
    .filter((action) => action.scope === 'table')
    .map((action) => action.id);
  const listed = tableActionRows.map((row) => row.id);
  assert.deepEqual([...listed].sort(), [...editor].sort());
  assert.equal(new Set(listed).size, listed.length);
});

await test('the row menu inserts, moves and deletes rows', () => {
  assert.deepEqual(
    tableMenuEntries('row', body).map((entry) => [entry.label, entry.group]),
    [
      ['Insert row above', 'insert'],
      ['Insert row below', 'insert'],
      ['Move row down', 'move'],
      ['Delete row', 'delete'],
    ],
  );
  // The first body row does not move above the header row, and the last
  // body row does not move below the end of the table.
  assert.deepEqual(
    tableMenuEntries('row', { ...body, row: 2 })
      .filter((entry) => entry.group === 'move')
      .map((entry) => entry.id),
    ['table-move-row-up'],
  );
  const deleteRow = tableMenuEntries('row', body).find(
    (entry) => entry.id === 'table-delete-row',
  );
  assert.equal(deleteRow?.danger, true);
});

await test('the header row takes no row above it, never moves and stays', () => {
  assert.deepEqual(
    tableMenuEntries('row', header).map((entry) => entry.id),
    ['table-row-below'],
  );
});

await test('the column menu inserts, moves, aligns and deletes columns', () => {
  assert.deepEqual(
    tableMenuEntries('column', { ...body, align: 'center' }).map((entry) => [
      entry.label,
      entry.current,
    ]),
    [
      ['Insert column left', false],
      ['Insert column right', false],
      ['Move column right', false],
      ['Align left', false],
      ['Align center', true],
      ['Align right', false],
      ['Delete column', false],
    ],
  );
  // The last column moves left and not right.
  assert.deepEqual(
    tableMenuEntries('column', { ...body, column: 1 })
      .filter((entry) => entry.group === 'move')
      .map((entry) => entry.id),
    ['table-move-column-left'],
  );
  // The last column of a table stays.
  assert.ok(
    !tableMenuEntries('column', { ...body, columns: 1 }).some(
      (entry) => entry.id === 'table-delete-column',
    ),
  );
});

await test('outside a table no menu has a row', () => {
  assert.deepEqual(tableMenuEntries('row', outsideTable), []);
  assert.deepEqual(tableMenuEntries('column', outsideTable), []);
});
