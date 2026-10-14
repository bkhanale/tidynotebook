/** The closed OAuth exception to problem normalization (0226). */
import assert from 'node:assert/strict';
import test from 'node:test';
// Generated runtime imports name build files, so test this owned build entry.
import { normalizeProtocolError } from '../dist/configure.js';

function record(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  return Object.fromEntries(Object.entries(value));
}
const request = new Request('https://notes.example/api/auth/oauth2/token');
const response = new Response(null, {
  status: 400,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});
test('the interceptor preserves only a closed declared OAuth error', () => {
  const good = {
    error: 'invalid_grant',
    error_description: 'The grant is refused.',
    error_uri: 'https://notes.example/help',
  };
  assert.deepEqual(normalizeProtocolError(good, response, request), good);
  for (const bad of [
    { error: 'invalid_grant', extra: 'value' },
    { error: 'unknown' },
    { error: 1 },
    { error: 'invalid_grant', error_description: null },
    ['invalid_grant'],
  ])
    assert.equal(
      record(normalizeProtocolError(bad, response, request)).code,
      'unexpected_response',
    );
  const wrongType = new Response(null, {
    status: 400,
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(
    record(normalizeProtocolError(good, wrongType, request)).code,
    'unexpected_response',
  );
  const problem = {
    type: 'about:blank',
    title: 'The request is refused.',
    status: 400,
    code: 'invalid_request',
    requestId: 'request',
  };
  assert.deepEqual(normalizeProtocolError(problem, response, request), problem);
  assert.equal(
    record(
      normalizeProtocolError(
        good,
        response,
        new Request('https://notes.example/api/workspaces'),
      ),
    ).code,
    'unexpected_response',
  );
});
