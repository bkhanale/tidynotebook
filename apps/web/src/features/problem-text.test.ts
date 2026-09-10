import assert from 'node:assert/strict';
import test from 'node:test';
import { hasProblemSentence, problemSentence } from './problem-text.ts';

/** Every code that a server answer can carry today. */
const codes = [
  'deleted_remotely',
  'forbidden',
  'internal_error',
  'invalid_content',
  'invalid_graph',
  'invalid_path',
  'invalid_request',
  'invalid_response',
  'mutation_reused',
  'not_found',
  'not_ready',
  'origin_required',
  'path_conflict',
  'payload_too_large',
  'precondition_required',
  'purged',
  'quota_exceeded',
  'route_not_found',
  'snapshot_required',
  'stale_head',
  'unauthenticated',
  'unauthorized',
  'unrenderable_note',
  'unsupported_media_type',
];

await test('every known code has one sentence', () => {
  for (const code of codes) {
    assert.ok(hasProblemSentence(code), code);
    const sentence = problemSentence(code, 400);
    assert.ok(sentence.endsWith('.'), code);
    assert.ok(!sentence.includes(code), code);
    assert.ok(!sentence.includes('_'), code);
  }
});

await test('an unknown code falls back to the status', () => {
  assert.equal(
    problemSentence('a_reason_from_a_newer_server', 404),
    problemSentence('not_found', 404),
  );
  assert.ok(
    !problemSentence('a_reason_from_a_newer_server', 418).includes('_'),
  );
});

await test('no answer at all reads as a connection problem', () => {
  const message = problemSentence(null, 0);
  assert.ok(message.includes('on this device'));
  assert.equal(problemSentence(null, null), message);
});

await test('a server failure asks the person to try again', () => {
  assert.ok(problemSentence(null, 503).includes('Try again'));
});
