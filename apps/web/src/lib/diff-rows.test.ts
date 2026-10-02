import assert from 'node:assert/strict';
import test from 'node:test';
import { compareLines, type DiffHunk } from '@notesapp/editor';
import {
  countDiffRows,
  diffBlockHeading,
  diffBlocks,
  diffRowSign,
  diffRowsOfHunk,
} from './diff-rows.ts';

/** The hunks of one complete comparison. */
function hunksOf(before: string, after: string): readonly DiffHunk[] {
  const result = compareLines(before, after);
  assert.equal(result.kind, 'complete');
  return result.kind === 'complete' ? result.hunks : [];
}

await test('a line that only gained a line ending reads as unchanged', () => {
  // Issue 254: a version that ended on "Pack the bags." and a text that
  // added a line after it showed "Pack the bags." as removed and added.
  const blocks = diffBlocks(
    hunksOf(
      '# Trip plan\n\nPack the bags.',
      '# Trip plan\n\nPack the bags.\nBook the train.',
    ),
  );
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0]?.rows, [
    { kind: 'context', text: '# Trip plan' },
    { kind: 'context', text: '' },
    { kind: 'context', text: 'Pack the bags.' },
    { kind: 'added', text: 'Book the train.' },
  ]);
  assert.deepEqual(countDiffRows(blocks), { added: 1, removed: 0 });
});

await test('a changed line reads as removed and added', () => {
  const blocks = diffBlocks(hunksOf('one\ntwo\nthree\n', 'one\nTWO\nthree\n'));
  assert.deepEqual(blocks[0]?.rows, [
    { kind: 'context', text: 'one' },
    { kind: 'removed', text: 'two' },
    { kind: 'added', text: 'TWO' },
    { kind: 'context', text: 'three' },
  ]);
  assert.deepEqual(countDiffRows(blocks), { added: 1, removed: 1 });
});

await test('a comparison whose only change is a line ending has no region', () => {
  const blocks = diffBlocks(hunksOf('one\ntwo', 'one\ntwo\n'));
  assert.deepEqual(blocks, []);
  assert.deepEqual(countDiffRows(blocks), { added: 0, removed: 0 });
});

await test('a Windows line ending is a line ending too', () => {
  const blocks = diffBlocks(hunksOf('one\r\ntwo\r\n', 'one\ntwo\n'));
  assert.deepEqual(blocks, []);
});

await test('a removed line keeps its words and loses only its ending', () => {
  const rows = diffRowsOfHunk({
    before: ['keep\n', 'gone\n'],
    after: ['keep\n'],
    beforeStart: 1,
    afterStart: 1,
  });
  assert.deepEqual(rows, [
    { kind: 'context', text: 'keep' },
    { kind: 'removed', text: 'gone' },
  ]);
});

await test('the heading names both sides by the labels of the screen', () => {
  assert.equal(
    diffBlockHeading(
      { beforeStart: 3, afterStart: 4, rows: [] },
      'This version',
      'Current version',
    ),
    'This version from line 3, current version from line 4',
  );
});

await test('the sign states the kind of a row without colour', () => {
  assert.equal(diffRowSign('removed'), '−');
  assert.equal(diffRowSign('added'), '+');
  assert.equal(diffRowSign('context'), '');
});
