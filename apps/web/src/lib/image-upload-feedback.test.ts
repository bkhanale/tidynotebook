import assert from 'node:assert/strict';
import test from 'node:test';
import {
  imageUploadInterruption,
  imageUploadTooLarge,
  imageUploadFailure,
} from './image-upload-feedback.ts';
import { problemSentence } from './problem-text.ts';

await test('an unsupported image states the accepted formats and action', () => {
  assert.equal(
    imageUploadFailure({ code: 'unsupported_media_type', status: 415 }),
    'The image format is not supported. Use PNG, JPEG, GIF or WebP.',
  );
});

await test('an unreadable or mismatched image states how to make a new file', () => {
  assert.equal(
    imageUploadFailure({ code: 'invalid_content', status: 422 }),
    'The image is not valid. Export it as PNG, JPEG, GIF or WebP, then try again.',
  );
});

await test('a shared size or timeout code asks for a smaller image without claiming size', () => {
  assert.equal(
    imageUploadFailure({ code: 'payload_too_large' }),
    'The image cannot be added. Use a smaller image.',
  );
});

await test('a known local byte cap states size and asks for a smaller image', () => {
  assert.equal(
    imageUploadTooLarge(),
    'The image is too large. Use a smaller image.',
  );
});

await test('an interruption states a general cause and next action', () => {
  assert.equal(
    imageUploadInterruption(),
    'The image cannot be added. Try again.',
  );
});

await test('quota, session, limit and connection failures keep their safe messages', () => {
  for (const value of [
    { code: 'quota_exceeded', status: 413, limit: null },
    { code: 'unauthenticated', status: 401, limit: null },
    { code: 'storage_busy', status: 429, limit: 'object_writes' },
    { code: 'download_limit', status: 429, limit: 'object_reads' },
    { code: 'unknown_cause', status: 503, limit: null },
  ]) {
    assert.equal(
      imageUploadFailure(value),
      problemSentence(value.code, value.status, value.limit),
    );
  }
  assert.equal(imageUploadFailure(undefined), problemSentence(null, null));
});

await test('engine, path and secret text in details or errors never becomes copy', () => {
  const sentinel = 'engine /private/path secret-sentinel';
  const failures: readonly unknown[] = [
    {
      code: 'invalid_content',
      status: 422,
      detail: sentinel,
      message: sentinel,
    },
    { code: sentinel, status: 422, detail: sentinel },
    new Error(sentinel),
    { code: 7, status: '422', limit: sentinel, detail: sentinel },
    Object.create({ code: 'invalid_content', status: 422, detail: sentinel }),
  ];
  for (const error of failures) {
    assert.ok(!imageUploadFailure(error).includes(sentinel));
    assert.ok(!imageUploadFailure(error).includes('/private/path'));
  }
});

await test('an object prototype name is an unknown cause with fixed fallback text', () => {
  for (const code of ['constructor', 'toString', '__proto__']) {
    assert.equal(
      imageUploadFailure({ code, status: 422 }),
      'The server refused the request. Try again.',
    );
  }
});
