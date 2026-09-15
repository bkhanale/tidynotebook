/**
 * Checks the guards of the attachment unions.
 *
 * Both unions leave the domain as text: a media type travels in a header and
 * a state sits in a database column. Each guard must accept every member and
 * refuse everything else, because the adapters of both runtimes turn its
 * answer into a stored record or into a refusal.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedMediaTypes,
  attachmentStates,
  isAllowedMediaType,
  isAttachmentState,
} from './attachments.ts';

await test('every declared media type is accepted', () => {
  for (const value of allowedMediaTypes)
    assert.equal(isAllowedMediaType(value), true, value);
  assert.equal(allowedMediaTypes.length, 4);
});

await test('a media type outside the list is refused', () => {
  // SVG is deliberately not an attachment type: it can carry script. The
  // other values cover a wrong case, a prefix, and an empty header.
  for (const value of [
    'image/svg+xml',
    'text/plain',
    'application/pdf',
    'IMAGE/PNG',
    'image/png; charset=utf-8',
    'image',
    '',
  ])
    assert.equal(isAllowedMediaType(value), false, value);
});

await test('every declared attachment state is accepted', () => {
  for (const value of attachmentStates)
    assert.equal(isAttachmentState(value), true, value);
  assert.deepEqual(
    [...attachmentStates],
    ['temporary', 'finalized', 'unavailable'],
  );
});

await test('a state outside the list is refused', () => {
  for (const value of ['deleted', 'pending', 'Finalized', ''])
    assert.equal(isAttachmentState(value), false, value);
});
