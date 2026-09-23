import assert from 'node:assert/strict';
import test from 'node:test';
import type { NoteSummary } from './note-list.ts';
import {
  compareNames,
  compareNotes,
  defaultNoteOrder,
  noteOrderLabel,
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
  assert.deepEqual(paths([...notes].sort(compareNotes('name-ascending'))), [
    'Apple.md',
    'banana.md',
    'cherry.md',
  ]);
});

await test('the reverse name order runs from Z to A', () => {
  assert.deepEqual(paths([...notes].sort(compareNotes('name-descending'))), [
    'cherry.md',
    'banana.md',
    'Apple.md',
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

await test('the date created order can put the newest note first', () => {
  assert.deepEqual(paths([...notes].sort(compareNotes('created-descending'))), [
    'banana.md',
    'cherry.md',
    'Apple.md',
  ]);
});

await test('the date created order can put the oldest note first', () => {
  assert.deepEqual(paths([...notes].sort(compareNotes('created-ascending'))), [
    'Apple.md',
    'cherry.md',
    'banana.md',
  ]);
});

await test('the date updated order can put the newest change first', () => {
  assert.deepEqual(paths([...notes].sort(compareNotes('updated-descending'))), [
    'Apple.md',
    'cherry.md',
    'banana.md',
  ]);
});

await test('the date updated order can put the oldest change first', () => {
  assert.deepEqual(paths([...notes].sort(compareNotes('updated-ascending'))), [
    'banana.md',
    'cherry.md',
    'Apple.md',
  ]);
});

await test('two notes of one instant take the name order in both directions', () => {
  const same = [
    note('b.md', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    note('a.md', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ];
  for (const order of ['updated-descending', 'updated-ascending'] as const)
    assert.deepEqual(paths([...same].sort(compareNotes(order))), [
      'a.md',
      'b.md',
    ]);
});

await test('a note with a bad instant goes last in a date order', () => {
  const mixed = [
    note('bad.md', 'not a date', 'not a date'),
    note('good.md', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ];
  assert.deepEqual(paths([...mixed].sort(compareNotes('created-descending'))), [
    'good.md',
    'bad.md',
  ]);
});

await test('a stored order is read back', () => {
  for (const order of noteOrders) assert.equal(parseNoteOrder(order), order);
});

await test('an unknown or missing stored order falls back to the name', () => {
  assert.equal(defaultNoteOrder, 'name-ascending');
  assert.equal(parseNoteOrder(null), 'name-ascending');
  assert.equal(parseNoteOrder('size'), 'name-ascending');
  assert.equal(parseNoteOrder('name'), 'name-ascending');
  assert.equal(parseNoteOrder(''), 'name-ascending');
});

await test('the menu offers each fact in both directions', () => {
  assert.deepEqual(
    noteOrders.map((order) => {
      const { label, hint } = noteOrderLabel(order);
      return `${label}, ${hint}`;
    }),
    [
      'Name, A to Z',
      'Name, Z to A',
      'Date created, Newest first',
      'Date created, Oldest first',
      'Date updated, Newest first',
      'Date updated, Oldest first',
    ],
  );
});
