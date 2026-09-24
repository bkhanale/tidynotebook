import assert from 'node:assert/strict';
import test from 'node:test';
import { formatActions, outsideTable } from '@notesapp/editor';
import { tableActionRows, tableMenuEntries } from './table-menu.ts';

/** A cell in a body row of a table of two columns, and one in its header. */
const body = { table: true, bodyRow: true, columns: 2, align: null } as const;
const header = { ...body, bodyRow: false } as const;

await test('every table action of the editor is in the one list, once', () => {
  const editor = formatActions
    .filter((action) => action.scope === 'table')
    .map((action) => action.id);
  const listed = tableActionRows.map((row) => row.id);
  assert.deepEqual([...listed].sort(), [...editor].sort());
  assert.equal(new Set(listed).size, listed.length);
});

await test('the row menu inserts and deletes rows', () => {
  assert.deepEqual(
    tableMenuEntries('row', body).map((entry) => entry.label),
    ['Insert row above', 'Insert row below', 'Delete row'],
  );
  const deleteRow = tableMenuEntries('row', body).find(
    (entry) => entry.id === 'table-delete-row',
  );
  assert.equal(deleteRow?.danger, true);
});

await test('the header row takes no row above it and is never deleted', () => {
  assert.deepEqual(
    tableMenuEntries('row', header).map((entry) => entry.id),
    ['table-row-below'],
  );
});

await test('the column menu inserts, aligns and deletes columns', () => {
  assert.deepEqual(
    tableMenuEntries('column', { ...body, align: 'center' }).map((entry) => [
      entry.label,
      entry.current,
    ]),
    [
      ['Insert column left', false],
      ['Insert column right', false],
      ['Align left', false],
      ['Align center', true],
      ['Align right', false],
      ['Delete column', false],
    ],
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
