import assert from 'node:assert/strict';
import test from 'node:test';
import { contentDisposition } from './export.ts';

await test('the download name is the last segment of the path', () => {
  assert.equal(
    contentDisposition('plans/quarter.md'),
    `attachment; filename="quarter.md"; filename*=UTF-8''quarter.md`,
  );
});

await test('a name outside ASCII travels in the encoded form', () => {
  assert.equal(
    contentDisposition('Grüße 🎉.md'),
    `attachment; filename="Gr__e _.md"; filename*=UTF-8''Gr%C3%BC%C3%9Fe%20%F0%9F%8E%89.md`,
  );
});

await test('a quote or a backslash cannot break the header field', () => {
  const header = contentDisposition('a"b\\c.md');
  assert.equal(header.includes('filename="a_b_c.md"'), true);
});
