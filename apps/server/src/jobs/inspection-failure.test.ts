import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectionErrors, inspectionFailure } from './inspection-failure.ts';

await test('each image failure has one fixed cause and action', () => {
  const expected = [
    'The image is too large. Use a smaller image.',
    'The image format is not supported. Use PNG, JPEG, GIF or WebP.',
    'The image does not match its file type. Export it as PNG, JPEG, GIF or WebP, then try again.',
    'The image cannot be read. Export it as PNG, JPEG, GIF or WebP, then try again.',
  ];
  for (const [index, error] of inspectionErrors.entries()) {
    assert.deepEqual(inspectionFailure(error), {
      ok: false,
      error,
      reason: expected[index],
    });
  }
});

await test('timeout keeps the size status code and states its own cause', () => {
  assert.deepEqual(inspectionFailure('timeout'), {
    ok: false,
    error: 'payload_too_large',
    reason: 'The image check took too long. Use a smaller image.',
  });
  assert.notEqual(
    inspectionFailure('timeout').reason,
    inspectionFailure('payload_too_large').reason,
  );
});
