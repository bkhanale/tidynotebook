import assert from 'node:assert/strict';
import test from 'node:test';
import { documentBounds } from './bounds.ts';
import { recoverLegacyText, splitLines } from './recovery.ts';

/** The outcome of one recovery over three texts. */
const recover = (base: string, local: string, accepted: string) =>
  recoverLegacyText({ base, local, accepted });

await test('a line keeps its own terminator', () => {
  assert.deepEqual(splitLines('a\r\nb\nc'), ['a\r\n', 'b\n', 'c']);
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('\n'), ['\n']);
});

await test('two changes in their own regions join', () => {
  const base = 'one\ntwo\nthree\nfour\nfive\n';
  const local = 'ONE\ntwo\nthree\nfour\nfive\n';
  const accepted = 'one\ntwo\nthree\nfour\nFIVE\n';
  assert.deepEqual(recover(base, local, accepted), {
    kind: 'merged',
    text: 'ONE\ntwo\nthree\nfour\nFIVE\n',
  });
});

await test('a text that did not change takes the other text', () => {
  const base = 'a\nb\n';
  assert.deepEqual(recover(base, base, 'a\nB\n'), {
    kind: 'merged',
    text: 'a\nB\n',
  });
  assert.deepEqual(recover(base, 'A\nb\n', base), {
    kind: 'merged',
    text: 'A\nb\n',
  });
  assert.deepEqual(recover(base, 'same\n', 'same\n'), {
    kind: 'merged',
    text: 'same\n',
  });
});

await test('two rewrites of one region are ambiguous', () => {
  const base = 'one\ntwo\nthree\n';
  assert.deepEqual(recover(base, 'one\nTWO\nthree\n', 'one\n2\nthree\n'), {
    kind: 'ambiguous',
    reason: 'overlapping-change',
  });
});

await test('a change beside a change is ambiguous', () => {
  // The two hunks touch, so their order in the result is not stated.
  const base = 'one\ntwo\nthree\n';
  assert.deepEqual(recover(base, 'one\nTWO\nthree\n', 'one\ntwo\nTHREE\n'), {
    kind: 'ambiguous',
    reason: 'overlapping-change',
  });
});

await test('the same insertion on both sides is ambiguous', () => {
  // It may be one insertion that both sides hold, or two of them.
  const base = 'one\ntwo\n';
  const both = 'one\nnew\ntwo\n';
  assert.deepEqual(recover(base, both, both.replace('two\n', 'two\nlater\n')), {
    kind: 'ambiguous',
    reason: 'duplicate-change',
  });
});

await test('a repeated passage makes a placement ambiguous', () => {
  const base = 'item\nitem\nend\n';
  const local = 'item\nitem\nitem\nend\n';
  const accepted = 'item\nitem\nend\nlast\n';
  assert.deepEqual(recover(base, local, accepted), {
    kind: 'ambiguous',
    reason: 'repeated-text',
  });
});

await test('a deletion inside a repeated passage is ambiguous', () => {
  // Two lines are equal, so the text does not say which one went away.
  const base = 'a\na\nb\n';
  assert.deepEqual(recover(base, 'a\nb\n', 'a\na\nB\n'), {
    kind: 'ambiguous',
    reason: 'repeated-text',
  });
});

await test('a deletion with one place only still joins', () => {
  // Deleting the first `a` and deleting the second give different texts, so
  // the place is stated and the two changes join.
  const base = 'a\nb\na\nc\n';
  assert.deepEqual(recover(base, 'b\na\nc\n', 'a\nb\na\nC\n'), {
    kind: 'merged',
    text: 'b\na\nC\n',
  });
});

await test('line endings and Unicode are never normalized', () => {
  const base = 'one\r\ntwo\r\n';
  const local = 'ONE\r\ntwo\r\n';
  const accepted = 'one\r\ntwo\r\né \u{1F600}\r\n';
  const outcome = recover(base, local, accepted);
  assert.deepEqual(outcome, {
    kind: 'merged',
    text: 'ONE\r\ntwo\r\né \u{1F600}\r\n',
  });
  // The combining mark and the surrogate pair survive as they were written.
  assert.ok(outcome.kind === 'merged' && outcome.text.includes('é'));
  assert.equal([...(outcome.text.match(/\r\n/gu) ?? [])].length, 3);
});

await test('a missing final newline is one change of the last line', () => {
  const base = 'a\nb';
  assert.deepEqual(recover(base, 'a\nb\n', 'A\nb'), {
    kind: 'ambiguous',
    reason: 'overlapping-change',
  });
  assert.deepEqual(recover('a\nb\nc', 'a\nb\nc\n', 'A\nb\nc'), {
    kind: 'merged',
    text: 'A\nb\nc\n',
  });
});

await test('the same three texts always give the same answer', () => {
  const base = 'one\ntwo\nthree\nfour\n';
  const local = 'one\nTWO\nthree\nfour\n';
  const accepted = 'one\ntwo\nthree\nFOUR\n';
  const first = recover(base, local, accepted);
  for (let round = 0; round < 5; round += 1)
    assert.deepEqual(recover(base, local, accepted), first);
});

await test('work past a recovery bound is refused, not guessed', () => {
  const lines = (count: number, word: string) =>
    Array.from(
      { length: count },
      (_, index) => `${word} ${String(index)}\n`,
    ).join('');
  const base = lines(documentBounds.maxRecoveryLines + 1, 'line');
  assert.deepEqual(
    recoverLegacyText({ base, local: `x\n${base}`, accepted: base + 'y\n' }),
    {
      kind: 'too-large',
    },
  );
  // A diff that needs more edits than the bound allows is refused as well.
  assert.deepEqual(
    recoverLegacyText(
      { base: lines(60, 'a'), local: lines(60, 'b'), accepted: lines(60, 'c') },
      { ...documentBounds, maxRecoveryEdits: 5 },
    ),
    { kind: 'too-large' },
  );
});
