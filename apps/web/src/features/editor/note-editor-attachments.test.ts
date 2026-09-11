import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractAttachmentIds,
  sanitizeAttachmentName,
} from './note-editor-attachments.ts';

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';

await test('the referenced attachment ids come out in order without repeats', () => {
  const text = `![one](/attachments/${idA}) and ![two](/attachments/${idB}) and ![again](/attachments/${idA})`;
  assert.deepEqual(extractAttachmentIds(text), [idA, idB]);
});

await test('a source with no attachment reference yields no id', () => {
  assert.deepEqual(extractAttachmentIds('plain text, no image'), []);
});

await test('the scan starts fresh, so a second call reads the same source', () => {
  const text = `![one](/attachments/${idA})`;
  assert.deepEqual(extractAttachmentIds(text), [idA]);
  assert.deepEqual(extractAttachmentIds(text), [idA]);
});

await test('a pasted file name becomes one safe path segment', () => {
  assert.equal(sanitizeAttachmentName('My Photo.PNG'), 'my-photo.png');
  assert.equal(sanitizeAttachmentName('a/b\\c:d.jpg'), 'a-b-c-d.jpg');
  assert.equal(sanitizeAttachmentName('  spaced  name '), 'spaced-name');
});

await test('a name with no safe characters falls back to a fixed name', () => {
  assert.equal(sanitizeAttachmentName('***'), 'pasted-image');
  assert.equal(sanitizeAttachmentName(''), 'pasted-image');
  assert.equal(sanitizeAttachmentName('.'), 'pasted-image');
});
