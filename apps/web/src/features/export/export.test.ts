import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadName } from './export.ts';

await test('the download name comes from the encoded form of the header', () => {
  assert.equal(
    downloadName(
      `attachment; filename="Gr__e.md"; filename*=UTF-8''Gr%C3%BC%C3%9Fe.md`,
      'note.md',
    ),
    'Grüße.md',
  );
});

await test('the quoted form is used when no encoded form is there', () => {
  assert.equal(
    downloadName('attachment; filename="plan.md"', 'note.md'),
    'plan.md',
  );
});

await test('a missing or unreadable header falls back to the given name', () => {
  assert.equal(downloadName(null, 'note.md'), 'note.md');
  assert.equal(downloadName('attachment', 'notes.zip'), 'notes.zip');
  assert.equal(
    downloadName(`attachment; filename*=UTF-8''%E0%A4%A`, 'note.md'),
    'note.md',
  );
});
