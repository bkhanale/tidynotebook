import assert from 'node:assert/strict';
import test from 'node:test';
import {
  corpusPath,
  corpusPlan,
  corpusShape,
  distribution,
  markdownOfSize,
  outliers,
  percentile,
} from './samples.ts';

await test('the corpus holds the notes and folders of the audit', () => {
  const plan = corpusPlan();
  assert.equal(plan.length, corpusShape.notes + 2);
  const folders = new Set(
    plan
      .slice(0, corpusShape.notes)
      .map((note) => note.path.split('/')[0] ?? ''),
  );
  assert.equal(folders.size, corpusShape.folders);
  assert.equal(new Set(plan.map((note) => note.path)).size, plan.length);
  for (const note of plan) assert.ok(note.path.endsWith('.md'));
});

await test('each note is at least its size and close to it', () => {
  const text = markdownOfSize('Note', corpusShape.noteBytes, 3);
  assert.ok(text.length >= corpusShape.noteBytes);
  assert.ok(text.length < corpusShape.noteBytes * 1.5);
  assert.match(text, /^# Note\n/);
  assert.match(text, /\]\(\.\.\/folder-00\/note-0000\.md\)/);
});

await test('the corpus is the same on every run', () => {
  assert.deepEqual(corpusPlan().slice(0, 3), corpusPlan().slice(0, 3));
  assert.equal(corpusPath(21), 'folder-01/note-0021.md');
});

await test('a percentile is the nearest rank of the sorted samples', () => {
  const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
  assert.equal(percentile(values, 0.5), 5);
  assert.equal(percentile(values, 0.95), 10);
  assert.equal(percentile(values, 0.1), 1);
  assert.equal(percentile([], 0.5), 0);
  assert.throws(() => percentile(values, 0));
});

await test('a distribution rounds to a tenth and states the worst', () => {
  assert.deepEqual(distribution([1.04, 2.26, 3.31]), {
    count: 3,
    p50: 2.3,
    p95: 3.3,
    p99: 3.3,
    max: 3.3,
  });
});

await test('an outlier names its trial, worst first', () => {
  assert.deepEqual(outliers([100, 2500, 50, 19_400], 2000), [
    { trial: 3, value: 19_400 },
    { trial: 1, value: 2500 },
  ]);
});
