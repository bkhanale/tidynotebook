import assert from 'node:assert/strict';
import test from 'node:test';
import { documentBounds } from './bounds.ts';
import {
  applyDocumentUpdate,
  documentStateVector,
  editDocumentRanges,
  encodeDocumentDelta,
  readDocumentText,
  startDocument,
  type DocumentRangeEdit,
  type DocumentResult,
  type AppliedDocument,
} from './document.ts';

function value(result: DocumentResult<AppliedDocument>) {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
await test('range edits preserve repeated character identities in either merge order', () => {
  const base = startDocument('aba');
  const deletion = value(
    editDocumentRanges(base, [{ offset: 0, length: 2, text: '' }]),
  );
  const device = value(
    editDocumentRanges(base, [{ offset: 2, length: 1, text: 'X' }]),
  );
  for (const [one, two] of [
    [deletion, device],
    [device, deletion],
  ] as const) {
    const merged = value(
      applyDocumentUpdate(
        one.document,
        encodeDocumentDelta(two.document, documentStateVector(base)),
      ),
    );
    assert.equal(merged.text, 'X');
  }
  const insert = value(
    editDocumentRanges(base, [{ offset: 2, length: 0, text: 'a' }]),
  );
  const merged = value(
    applyDocumentUpdate(
      device.document,
      encodeDocumentDelta(insert.document, documentStateVector(base)),
    ),
  );
  assert.equal(merged.text, 'abaX');
});
await test('ranges refer to original offsets and apply last to first', () => {
  const base = startDocument('abcdef');
  assert.equal(
    value(
      editDocumentRanges(base, [
        { offset: 0, length: 1, text: 'START' },
        { offset: 5, length: 1, text: 'END' },
        { offset: 2, length: 2, text: '' },
      ]),
    ).text,
    'STARTbeEND',
  );
  assert.equal(
    value(
      editDocumentRanges(base, [
        { offset: 1, length: 1, text: 'B' },
        { offset: 2, length: 1, text: 'C' },
      ]),
    ).text,
    'aBCdef',
  );
  assert.equal(value(editDocumentRanges(base, [])).text, 'abcdef');
});
await test('invalid ranges refuse atomically, including Unicode pair boundaries', () => {
  const base = startDocument('a😀bc');
  const copy = base.slice();
  const invalid: readonly DocumentRangeEdit[][] = [
    [{ offset: -1, length: 0, text: '' }],
    [{ offset: 1, length: -1, text: '' }],
    [{ offset: 0.5, length: 1, text: '' }],
    [{ offset: NaN, length: 1, text: '' }],
    [{ offset: 6, length: 0, text: '' }],
    [{ offset: 4, length: 2, text: '' }],
    [{ offset: 1, length: 1, text: '' }],
    [{ offset: 2, length: 0, text: 'X' }],
    [
      { offset: 0, length: 3, text: '' },
      { offset: 1, length: 2, text: 'x' },
    ],
    [
      { offset: 1, length: 0, text: 'x' },
      { offset: 1, length: 0, text: 'y' },
    ],
    [
      { offset: 1, length: 0, text: 'x' },
      { offset: 1, length: 2, text: 'y' },
    ],
  ];
  for (const edits of invalid) {
    assert.deepEqual(editDocumentRanges(base, edits), {
      ok: false,
      refusal: 'invalid-range',
    });
    assert.deepEqual(base, copy);
  }
  assert.deepEqual(
    editDocumentRanges(base, [{ offset: 0, length: 0, text: '\ud800' }]),
    { ok: false, refusal: 'not-well-formed' },
  );
  assert.equal(
    value(editDocumentRanges(base, [{ offset: 1, length: 2, text: '🌈' }]))
      .text,
    'a🌈bc',
  );
  assert.equal(readDocumentText(base), 'a😀bc');
});
await test('range count, inserted text, update bytes, structures and document bounds refuse atomically', () => {
  const base = startDocument('abcdef');
  const edits = [{ offset: 2, length: 0, text: 'more' }];
  for (const bounds of [
    { ...documentBounds, maxRangeEdits: 0 },
    { ...documentBounds, maxDocumentBytes: 2 },
    { ...documentBounds, maxUpdateBytes: 1 },
    { ...documentBounds, maxUpdateStructs: 0 },
    { ...documentBounds, maxDocumentBytes: base.byteLength },
  ])
    assert.deepEqual(editDocumentRanges(base, edits, bounds), {
      ok: false,
      refusal: 'too-large',
    });
  assert.equal(readDocumentText(base), 'abcdef');
});
