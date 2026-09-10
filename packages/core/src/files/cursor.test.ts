import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFileCursor, encodeFileCursor } from './cursor.ts';

const fileId = '11111111-2222-3333-4444-555555555555';

await test('a path cursor keeps every character of the path', () => {
  const cursor = {
    sort: 'path' as const,
    key: 'plans/my note (draft).md',
    fileId,
  };
  const decoded = decodeFileCursor(encodeFileCursor(cursor), 'path');
  assert.deepEqual(decoded, cursor);
});

await test('an updated cursor keeps the instant', () => {
  const cursor = {
    sort: 'updated' as const,
    key: '2026-09-07T10:00:00.000Z',
    fileId,
  };
  const decoded = decodeFileCursor(encodeFileCursor(cursor), 'updated');
  assert.deepEqual(decoded, cursor);
});

await test('a cursor of the other sort is refused', () => {
  const encoded = encodeFileCursor({
    sort: 'path',
    key: 'a.md',
    fileId,
  });
  assert.equal(decodeFileCursor(encoded, 'updated'), null);
});

await test('a cursor that names no file of this server is refused', () => {
  assert.equal(decodeFileCursor('path.not-a-file.a.md', 'path'), null);
  assert.equal(decodeFileCursor('path', 'path'), null);
  assert.equal(decodeFileCursor(`path.${fileId}`, 'path'), null);
});

await test('an updated cursor without an instant is refused', () => {
  assert.equal(decodeFileCursor(`updated.${fileId}.tomorrow`, 'updated'), null);
});
