import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyRowWindow,
  revealScrollTop,
  rowWindow,
  sameRowWindow,
} from './row-window.ts';

/** A list of 1010 rows of 32 px in a scroller of 800 px. */
const base = {
  count: 1010,
  stride: 32,
  listTop: 0,
  viewportHeight: 800,
  overscan: 8,
} as const;

await test('a list of 1010 rows renders the rows in view and the overscan', () => {
  // Issue 256: All notes rendered every row, 11582 elements.
  const window = rowWindow(base);
  assert.deepEqual(window, {
    start: 0,
    end: 33,
    before: 0,
    after: (1010 - 33) * 32,
  });
});

await test('the space and the rows always add up to the whole list', () => {
  for (const listTop of [0, -1, -500, -16_000, -32_000, -40_000, 300, 900]) {
    const window = rowWindow({ ...base, listTop });
    assert.equal(
      window.before + (window.end - window.start) * 32 + window.after,
      1010 * 32,
      String(listTop),
    );
    assert.ok(window.end - window.start <= 25 + 2 * 8 + 1, String(listTop));
  }
});

await test('a scroll keeps the visible rows and the overscan on both sides', () => {
  const window = rowWindow({ ...base, listTop: -3200 });
  // Row 100 is the first one in view, row 125 the last.
  assert.equal(window.start, 92);
  assert.equal(window.end, 133);
  assert.equal(window.before, 92 * 32);
});

await test('the end of the list renders its last rows', () => {
  const window = rowWindow({ ...base, listTop: -(1010 * 32 - 800) });
  assert.equal(window.end, 1010);
  assert.equal(window.after, 0);
});

await test('a list below the visible part keeps its first rows', () => {
  const window = rowWindow({ ...base, listTop: 2000 });
  assert.deepEqual(window, {
    start: 0,
    end: 8,
    before: 0,
    after: (1010 - 8) * 32,
  });
});

await test('a list above the visible part keeps its last rows', () => {
  const window = rowWindow({ ...base, listTop: -100_000 });
  assert.deepEqual(window, {
    start: 1002,
    end: 1010,
    before: 1002 * 32,
    after: 0,
  });
});

await test('a list that starts inside the visible part renders from its top', () => {
  const window = rowWindow({ ...base, listTop: 400 });
  assert.equal(window.start, 0);
  assert.equal(window.end, 13 + 8);
});

await test('a short list renders every row and holds no space', () => {
  assert.deepEqual(rowWindow({ ...base, count: 12 }), {
    start: 0,
    end: 12,
    before: 0,
    after: 0,
  });
});

await test('a list with no row renders nothing', () => {
  assert.deepEqual(rowWindow({ ...base, count: 0 }), emptyRowWindow);
});

await test('a stride that nobody measured renders every row', () => {
  for (const stride of [0, -4, Number.NaN])
    assert.deepEqual(rowWindow({ ...base, count: 40, stride }), {
      start: 0,
      end: 40,
      before: 0,
      after: 0,
    });
});

await test('two windows of the same rows are the same', () => {
  const window = rowWindow(base);
  assert.ok(sameRowWindow(window, { ...window }));
  assert.ok(!sameRowWindow(window, rowWindow({ ...base, listTop: -3200 })));
});

await test('a row out of view comes into view at the nearest edge', () => {
  const view = {
    stride: 32,
    listOffset: 40,
    viewportHeight: 800,
    rowHeight: 28,
  } as const;
  // Row 100 sits at 40 + 3200: below the view, so its foot meets the edge.
  assert.equal(
    revealScrollTop({ ...view, index: 100, scrollTop: 0 }),
    40 + 3200 + 28 - 800,
  );
  // Row 2 sits above a scrolled view, so its top meets the edge.
  assert.equal(revealScrollTop({ ...view, index: 2, scrollTop: 5000 }), 104);
  // A row in view does not move the scroller.
  assert.equal(revealScrollTop({ ...view, index: 3, scrollTop: 0 }), null);
});
