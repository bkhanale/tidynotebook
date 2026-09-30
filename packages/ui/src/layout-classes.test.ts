/** The pure layout choices of shared page furniture. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentPageSection,
  pageColumnClassName,
  pageHeaderActionsClassName,
  pageRowClassName,
  pageSectionLine,
  pageSectionsShown,
  pageSideClassName,
} from './layout-classes.ts';

await test('split page actions occupy the row and keep its two ends', () => {
  const classes = pageHeaderActionsClassName('split').split(' ');

  assert.ok(classes.includes('w-full'));
  assert.ok(classes.includes('justify-between'));
  assert.ok(classes.includes('gap-group'));
  assert.ok(!classes.includes('shrink-0'));
});

await test('clustered page actions keep their compact default', () => {
  const classes = pageHeaderActionsClassName('cluster').split(' ');

  assert.ok(classes.includes('shrink-0'));
  assert.ok(classes.includes('gap-cluster'));
  assert.ok(!classes.includes('w-full'));
});

await test('every page column is the note measure, centred in its row', () => {
  // Decision 0137. One measure and one centre on every page, so a move
  // between two pages does not move the column.
  const column = pageColumnClassName().split(' ');
  assert.ok(column.includes('max-w-note'));
  assert.ok(column.includes('mx-auto'));
  assert.ok(column.includes('flex-1'));
  assert.ok(column.includes('min-w-0'));
  assert.ok(!column.some((name) => /^max-w-(?!note$)/.test(name)));
});

await test('the side region has one width and shows from the extra large width', () => {
  const side = pageSideClassName().split(' ');
  assert.ok(side.includes('w-56'));
  assert.ok(side.includes('shrink-0'));
  assert.ok(side.includes('hidden'));
  assert.ok(side.includes('xl:flex'));
});

await test('the row puts the column and the side region side by side', () => {
  const row = pageRowClassName().split(' ');
  assert.ok(row.includes('flex'));
  assert.ok(row.includes('gap-6'));
});

await test('a page lists its sections only when it has two or more', () => {
  assert.equal(pageSectionsShown([]), false);
  assert.equal(pageSectionsShown([{ id: 'a', title: 'A' }]), false);
  assert.equal(
    pageSectionsShown([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ]),
    true,
  );
});

await test('the current section is the last one that passed the line', () => {
  const tops = [
    { id: 'a', top: -400 },
    { id: 'b', top: pageSectionLine },
    { id: 'c', top: pageSectionLine + 1 },
  ];
  assert.equal(currentPageSection(tops, false), 'b');
});

await test('the first section is current before any passes the line', () => {
  const tops = [
    { id: 'a', top: 100 },
    { id: 'b', top: 600 },
  ];
  assert.equal(currentPageSection(tops, false), 'a');
});

await test('the last section is current at the end of the scroll', () => {
  // A short last section never reaches the line, so without this rule its
  // row could never be current.
  const tops = [
    { id: 'a', top: -400 },
    { id: 'b', top: 10 },
    { id: 'c', top: 300 },
  ];
  assert.equal(currentPageSection(tops, true), 'c');
});

await test('a page with no section has no current section', () => {
  assert.equal(currentPageSection([], false), null);
  assert.equal(currentPageSection([], true), null);
});
