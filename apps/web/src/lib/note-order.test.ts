import assert from 'node:assert/strict';
import test from 'node:test';
import type { NoteSummary } from './note-list.ts';
import {
  compareNames,
  compareNotes,
  defaultNoteOrder,
  noteOrderLabels,
  noteOrders,
  parseNoteOrder,
} from './note-order.ts';

const note = (
  path: string,
  createdAt: string,
  updatedAt: string,
): NoteSummary => ({
  fileId: path,
  path,
  createdAt,
  updatedAt,
  localOnly: false,
  unsent: false,
});

const paths = (notes: readonly NoteSummary[]): readonly string[] =>
  notes.map((entry) => entry.path);

const notes = [
  note('banana.md', '2026-01-03T00:00:00Z', '2026-01-04T00:00:00Z'),
  note('Apple.md', '2026-01-01T00:00:00Z', '2026-01-06T00:00:00Z'),
  note('cherry.md', '2026-01-02T00:00:00Z', '2026-01-05T00:00:00Z'),
];

await test('the name order is the alphabet without case', () => {
  assert.deepEqual(paths([...notes].sort(compareNotes('name'))), [
    'Apple.md',
    'banana.md',
    'cherry.md',
  ]);
});

await test('the name order reads a number as a number', () => {
  assert.ok(compareNames('Note 2', 'Note 10') < 0);
});

await test('two names that differ in case keep one fixed order', () => {
  assert.ok(compareNames('Note', 'note') < 0);
  assert.ok(compareNames('note', 'Note') > 0);
  assert.equal(compareNames('note', 'note'), 0);
});

await test('the date created order puts the newest note first', () => {
  assert.deepEqual(paths([...notes].sort(compareNotes('created'))), [
    'banana.md',
    'cherry.md',
    'Apple.md',
  ]);
});

await test('the date updated order puts the newest change first', () => {
  assert.deepEqual(paths([...notes].sort(compareNotes('updated'))), [
    'Apple.md',
    'cherry.md',
    'banana.md',
  ]);
});

await test('two notes of one instant take the name order', () => {
  const same = [
    note('b.md', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    note('a.md', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ];
  assert.deepEqual(paths([...same].sort(compareNotes('updated'))), [
    'a.md',
    'b.md',
  ]);
});

await test('a note with a bad instant goes last in a date order', () => {
  const mixed = [
    note('bad.md', 'not a date', 'not a date'),
    note('good.md', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ];
  assert.deepEqual(paths([...mixed].sort(compareNotes('created'))), [
    'good.md',
    'bad.md',
  ]);
});

await test('a stored order is read back', () => {
  for (const order of noteOrders) assert.equal(parseNoteOrder(order), order);
});

await test('an unknown or missing stored order falls back to the name', () => {
  assert.equal(defaultNoteOrder, 'name');
  assert.equal(parseNoteOrder(null), 'name');
  assert.equal(parseNoteOrder('size'), 'name');
  assert.equal(parseNoteOrder(''), 'name');
});

await test('every order has a label and a direction', () => {
  for (const order of noteOrders) {
    assert.notEqual(noteOrderLabels[order].label, '');
    assert.notEqual(noteOrderLabels[order].hint, '');
  }
});
