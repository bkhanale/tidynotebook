/**
 * The reading of the lines of an open note follows its changes, and a change
 * reads only the parts that it touches (record 0182).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ChangeSet, Text } from '@codemirror/state';
import {
  lineLimits,
  limitsOfMeasure,
  measureParts,
  type PartsMeasure,
} from '@notesapp/markdown';
import { changedParts, measureAfter, measureNote } from './note-measure.ts';

/** A reader that counts the lines that it reads. */
function countingRead(): {
  readonly read: (lines: Iterable<string>) => PartsMeasure;
  readonly lines: () => number;
} {
  let count = 0;
  return {
    read: (lines) =>
      measureParts(
        (function* counted(): Generator<string> {
          for (const line of lines) {
            count += 1;
            yield line;
          }
        })(),
      ),
    lines: () => count,
  };
}

/** A deterministic sequence of numbers below one, from a seed. */
function randomFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** The pieces that a random note and a random change are made of. */
const pieces = [
  '',
  '\n',
  '\n\n',
  ' ',
  'word',
  '*',
  '_',
  '[',
  ']',
  '<',
  '$',
  '\\(',
  '|',
  '|-|',
  '| a | b |',
  '|---|---|',
  '> ',
  '- ',
  '1. ',
  '    ',
  '\t',
  '`',
  'é',
  '😀',
];

/** A random text of `count` pieces. */
function randomText(next: () => number, count: number): string {
  let text = '';
  for (let index = 0; index < count; index += 1)
    text += pieces[Math.floor(next() * pieces.length)] ?? '';
  return text;
}

await test('the reading after a change is the reading of the whole new note', () => {
  const next = randomFrom(182);
  for (let round = 0; round < 3000; round += 1) {
    let doc = Text.of(randomText(next, 40).split('\n'));
    let measure = measureNote(doc);
    // A few changes in a row, as typing makes them, each read from the last.
    for (let step = 0; step < 4; step += 1) {
      const specs = [];
      let at = 0;
      const ranges = 1 + Math.floor(next() * 3);
      for (let range = 0; range < ranges && at <= doc.length; range += 1) {
        const from = at + Math.floor(next() * (doc.length - at + 1));
        const to =
          from + Math.floor(next() * Math.min(6, doc.length - from + 1));
        specs.push({
          from,
          to,
          insert: randomText(next, Math.floor(next() * 4)),
        });
        at = to + 1;
      }
      const changes = ChangeSet.of(specs, doc.length);
      const after = changes.apply(doc);
      measure = measureAfter(measure, doc, changes, after);
      assert.deepEqual(measure, measureNote(after), JSON.stringify(specs));
      assert.equal(limitsOfMeasure(measure), lineLimits(after.iterLines()));
      doc = after;
    }
  }
});

await test('a key in a long note reads only the part that it touches', () => {
  // The audit of 2026-10-02: the gate read every line of the note on each
  // key, so a key in a note of 500 KB took longer than the gap to the next.
  const part = (index: number): string =>
    `## Part ${String(index)}\n\nSome *words* and a [link](u).\n\n- one\n- two`;
  const text = Array.from({ length: 5000 }, (_, index) => part(index)).join(
    '\n\n',
  );
  const doc = Text.of(text.split('\n'));
  const counter = countingRead();
  const measure = measureNote(doc);
  const at = text.indexOf('Some *words*', text.length / 2);
  const key = ChangeSet.of({ from: at, insert: 'k' }, doc.length);
  const after = key.apply(doc);
  const next = measureAfter(measure, doc, key, after, counter.read);
  assert.deepEqual(next, measureNote(after));
  // The paragraph and the blank line on each side, before and after.
  assert.equal(counter.lines(), 6);
  assert.deepEqual(changedParts(doc, key, after), [
    {
      before: {
        first: doc.lineAt(at).number - 1,
        last: doc.lineAt(at).number + 1,
      },
      after: {
        first: after.lineAt(at).number - 1,
        last: after.lineAt(at).number + 1,
      },
    },
  ]);
});

await test('a key that fills a blank line reads the two parts it joins', () => {
  const doc = Text.of(['a *b*', 'c', '', 'd', 'e _f_', '', 'g']);
  const blank = doc.line(3).from;
  const key = ChangeSet.of({ from: blank, insert: 'x' }, doc.length);
  const after = key.apply(doc);
  assert.deepEqual(changedParts(doc, key, after), [
    { before: { first: 1, last: 6 }, after: { first: 1, last: 6 } },
  ]);
  assert.deepEqual(
    measureAfter(measureNote(doc), doc, key, after),
    measureNote(after),
  );
});

await test('two changes far apart read two runs, and near ones read one', () => {
  const doc = Text.of(['a', '', 'b', '', 'c', '', 'd', '', 'e']);
  const far = ChangeSet.of(
    [
      { from: doc.line(1).from, insert: 'x' },
      { from: doc.line(9).from, insert: 'y' },
    ],
    doc.length,
  );
  assert.deepEqual(
    changedParts(doc, far, far.apply(doc)).map((pair) => pair.before),
    [
      { first: 1, last: 2 },
      { first: 8, last: 9 },
    ],
  );
  const near = ChangeSet.of(
    [
      { from: doc.line(3).from, insert: 'x' },
      { from: doc.line(5).from, insert: 'y' },
    ],
    doc.length,
  );
  assert.deepEqual(
    changedParts(doc, near, near.apply(doc)).map((pair) => pair.before),
    [{ first: 2, last: 6 }],
  );
});
