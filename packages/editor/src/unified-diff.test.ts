/**
 * Bounded line comparison checks.
 *
 * These tests assert exact hunk boundaries, whitespace and line ending
 * fidelity, the edit limit, and merge round trips. They cover the public
 * behavior of the comparison: identical texts, insertions, whitespace-only
 * changes, CRLF against LF, a missing final newline, hunk grouping, and the
 * decisions of the merge helper.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alignLines,
  compareLines,
  diffContextLines,
  maxDiffEdits,
  mergeHunks,
  type DiffHunk,
  type DiffResult,
} from './unified-diff.ts';

/** The hunks of a complete result, or a failure naming the kind. */
function hunksOf(result: DiffResult): readonly DiffHunk[] {
  assert.equal(result.kind, 'complete', `expected a complete diff`);
  return result.kind === 'complete' ? result.hunks : [];
}

/** Chooses `take` for every hunk. */
function every(
  count: number,
  take: 'before' | 'after',
): Array<{ readonly take: 'before' | 'after' }> {
  return Array.from({ length: count }, () => ({ take }));
}

await test('identical texts yield no hunks', () => {
  const result = compareLines('# Title\n\nBody.\n', '# Title\n\nBody.\n');
  assert.deepEqual(hunksOf(result), []);
});

await test('two empty texts yield no hunks', () => {
  assert.deepEqual(hunksOf(compareLines('', '')), []);
});

await test('a changed line reports exact lines and 1-based starts', () => {
  const result = hunksOf(compareLines('a\nb\nc\n', 'a\nB\nc\n'));
  assert.equal(result.length, 1);
  const hunk = result[0];
  assert.ok(hunk !== undefined);
  assert.equal(hunk.beforeStart, 1);
  assert.equal(hunk.afterStart, 1);
  assert.deepEqual([...hunk.before], ['a\n', 'b\n', 'c\n']);
  assert.deepEqual([...hunk.after], ['a\n', 'B\n', 'c\n']);
});

await test('an insertion keeps its terminator and position', () => {
  const result = hunksOf(compareLines('a\nc\n', 'a\nb\nc\n'));
  assert.equal(result.length, 1);
  const hunk = result[0];
  assert.ok(hunk !== undefined);
  assert.equal(hunk.beforeStart, 1);
  assert.equal(hunk.afterStart, 1);
  assert.deepEqual([...hunk.before], ['a\n', 'c\n']);
  assert.deepEqual([...hunk.after], ['a\n', 'b\n', 'c\n']);
});

await test('a whitespace-only change is a change', () => {
  const result = hunksOf(compareLines('line\n', 'line  \n'));
  assert.equal(result.length, 1);
  assert.deepEqual([...(result[0]?.after ?? [])], ['line  \n']);
});

await test('CRLF against LF is a change', () => {
  const result = hunksOf(compareLines('a\r\nb\r\n', 'a\nb\n'));
  assert.equal(result.length, 1);
  const hunk = result[0];
  assert.ok(hunk !== undefined);
  assert.deepEqual([...hunk.before], ['a\r\n', 'b\r\n']);
  assert.deepEqual([...hunk.after], ['a\n', 'b\n']);
});

await test('a missing final newline is a change', () => {
  const result = hunksOf(compareLines('a\n', 'a'));
  assert.equal(result.length, 1);
  assert.deepEqual([...(result[0]?.before ?? [])], ['a\n']);
  assert.deepEqual([...(result[0]?.after ?? [])], ['a']);
});

await test('distant changes form one hunk per region with context', () => {
  const before = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\n';
  const after = 'L1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nL12\n';
  const result = hunksOf(compareLines(before, after));
  assert.equal(result.length, 2);
  const first = result[0];
  const second = result[1];
  assert.ok(first !== undefined && second !== undefined);
  assert.equal(first.beforeStart, 1);
  assert.equal(first.before.length, 1 + diffContextLines);
  assert.equal(second.beforeStart, 12 - diffContextLines);
  assert.ok(second.beforeStart > first.beforeStart);
});

await test('nearby changes merge into one hunk', () => {
  const result = hunksOf(compareLines('a\nb\nc\nd\ne\n', 'A\nb\nc\nD\ne\n'));
  assert.equal(result.length, 1);
  const hunk = result[0];
  assert.ok(hunk !== undefined);
  assert.equal(hunk.beforeStart, 1);
  assert.deepEqual([...hunk.before], ['a\n', 'b\n', 'c\n', 'd\n', 'e\n']);
  assert.deepEqual([...hunk.after], ['A\n', 'b\n', 'c\n', 'D\n', 'e\n']);
});

await test('a fully rewritten large text reaches the edit limit', () => {
  const lines = (prefix: string): string =>
    Array.from(
      { length: maxDiffEdits + 1_000 },
      (_, index) => `${prefix}${String(index)}\n`,
    ).join('');
  const result = compareLines(lines('before-'), lines('after-'));
  assert.equal(result.kind, 'limit');
});

await test('a large file with one changed line still diffs', () => {
  const head = Array.from(
    { length: 10_000 },
    (_, index) => `line ${String(index)}\n`,
  ).join('');
  const before = `${head}old\n${head}`;
  const after = `${head}new\n${head}`;
  const result = hunksOf(compareLines(before, after));
  assert.equal(result.length, 1);
  const hunk = result[0];
  assert.ok(hunk !== undefined);
  assert.equal(hunk.beforeStart, 10_001 - diffContextLines);
  assert.equal(hunk.afterStart, 10_001 - diffContextLines);
  assert.deepEqual(
    [...hunk.before],
    [
      'line 9997\n',
      'line 9998\n',
      'line 9999\n',
      'old\n',
      'line 0\n',
      'line 1\n',
      'line 2\n',
    ],
  );
});

await test('merge with before everywhere reproduces the before text', () => {
  const before = 'a\nb\nc\nd\ne\nf\ng\nh\n';
  const after = 'A\nb\nc\nd\ne\nf\ng\nH\n';
  const result = compareLines(before, after);
  const hunks = hunksOf(result);
  assert.ok(hunks.length > 0);
  assert.equal(
    mergeHunks(before, after, hunks, every(hunks.length, 'before')),
    before,
  );
});

await test('merge with after everywhere reproduces the after text', () => {
  const before = 'a\nb\nc\nd\ne\nf\ng\nh\n';
  const after = 'A\nb\nc\nD\ne\nf\ng\nH\n';
  const result = compareLines(before, after);
  const hunks = hunksOf(result);
  assert.ok(hunks.length > 0);
  assert.equal(
    mergeHunks(before, after, hunks, every(hunks.length, 'after')),
    after,
  );
});

await test('merge mixes per-hunk decisions and custom text', () => {
  const mid = 'm1\nm2\nm3\nm4\nm5\nm6\nm7\n';
  const before = `keep\nold-a\n${mid}old-b\ntail\n`;
  const after = `keep\nnew-a\n${mid}new-b\ntail\n`;
  const hunks = hunksOf(compareLines(before, after));
  assert.equal(hunks.length, 2);
  const second = hunks[1];
  assert.ok(second !== undefined);
  const edited = [...second.after]
    .map((line) => (line === 'new-b\n' ? 'edited-b\n' : line))
    .join('');
  const merged = mergeHunks(before, after, hunks, [
    { take: 'before' },
    { take: 'custom', text: edited },
  ]);
  assert.equal(merged, `keep\nold-a\n${mid}edited-b\ntail\n`);
});

await test('merge rejects a decision count that misses a hunk', () => {
  const before = 'a\nb\n';
  const after = 'A\nB\n';
  const hunks = hunksOf(compareLines(before, after));
  assert.ok(hunks.length > 0);
  assert.throws(() => mergeHunks(before, after, hunks, []));
});

await test('unicode and lone carriage returns survive the round trip', () => {
  const before = 'caf\u00e9\rold \u{1F600}\n';
  const after = 'caf\u00e9\rnew \u{1F600}\n';
  const hunks = hunksOf(compareLines(before, after));
  assert.equal(hunks.length, 1);
  assert.equal(
    mergeHunks(before, after, hunks, every(hunks.length, 'after')),
    after,
  );
});

await test('alignment names exact positions including interior context', () => {
  const aligned = alignLines(
    'keep\nold-a\nmid\nold-b\ntail\n',
    'keep\nnew-a\nmid\nnew-b\ntail\n',
  );
  assert.ok(aligned !== null);
  assert.deepEqual(
    aligned.map((entry) => entry.kind),
    ['same', 'del', 'add', 'same', 'del', 'add', 'same'],
  );
  const same = aligned[3];
  assert.ok(same !== undefined && same.kind === 'same');
  assert.equal(same.beforeIndex, 2);
  assert.equal(same.afterIndex, 2);
});

await test('alignment returns null past the bound', () => {
  const lines = (prefix: string): string =>
    Array.from(
      { length: maxDiffEdits + 1_000 },
      (_, index) => `${prefix}${String(index)}\n`,
    ).join('');
  assert.equal(alignLines(lines('before-'), lines('after-')), null);
});
