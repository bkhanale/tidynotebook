import assert from 'node:assert/strict';
import test from 'node:test';
import { changeCountText, rowChangeOf, rowChangeText } from './history-rows.ts';

await test('a count reads as plain words in both numbers', () => {
  assert.equal(changeCountText({ added: 1, removed: 0 }), '1 line added');
  assert.equal(
    changeCountText({ added: 3, removed: 2 }),
    '3 lines added, 2 lines removed',
  );
  assert.equal(changeCountText({ added: 0, removed: 1 }), '1 line removed');
  assert.equal(changeCountText({ added: 0, removed: 0 }), 'No line changed');
});

await test('the first version has nothing to compare with', () => {
  const change = rowChangeOf({
    deleted: false,
    restored: false,
    first: true,
    count: null,
  });
  assert.deepEqual(change, { kind: 'first' });
  assert.equal(rowChangeText(change), 'First version');
});

await test('a deletion is the whole message of its version', () => {
  const change = rowChangeOf({
    deleted: true,
    restored: false,
    first: false,
    count: { added: 0, removed: 9 },
  });
  assert.equal(rowChangeText(change), 'Note deleted');
});

await test('a restore says so and still reports its counts', () => {
  const change = rowChangeOf({
    deleted: false,
    restored: true,
    first: false,
    count: { added: 4, removed: 1 },
  });
  assert.equal(
    rowChangeText(change),
    'Earlier text brought back, 4 lines added, 1 line removed',
  );
});

await test('a comparison that did not finish still says something true', () => {
  const change = rowChangeOf({
    deleted: false,
    restored: false,
    first: false,
    count: null,
  });
  assert.equal(rowChangeText(change), 'Text changed');
});

await test('no row reading names a revision or an instant', () => {
  const readings = [
    rowChangeText(
      rowChangeOf({
        deleted: false,
        restored: false,
        first: false,
        count: { added: 2, removed: 0 },
      }),
    ),
    rowChangeText(
      rowChangeOf({
        deleted: true,
        restored: false,
        first: false,
        count: null,
      }),
    ),
  ];
  for (const reading of readings) {
    assert.doesNotMatch(reading, /[0-9a-f]{8}-[0-9a-f]{4}/);
    assert.doesNotMatch(reading, /\d{4}-\d{2}-\d{2}T/);
  }
});
