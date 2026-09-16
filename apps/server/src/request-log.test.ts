import assert from 'node:assert/strict';
import test from 'node:test';
import { redactPath, redactUrl } from './request-log.ts';

await test('redactUrl removes a password reset token from the path', () => {
  const token = 'live-reset-token';

  assert.equal(
    redactUrl(`/api/auth/reset-password/${token}`),
    '/api/auth/reset-password/[redacted]',
  );
  assert.equal(
    redactUrl(`/api/auth/reset-password/${token}?callbackURL=/notes`),
    '/api/auth/reset-password/[redacted]?[redacted]',
  );
});

await test('redactUrl keeps a path that has no secret segment', () => {
  assert.equal(
    redactUrl('/api/auth/reset-password'),
    '/api/auth/reset-password',
  );
  assert.equal(redactUrl('/api/health'), '/api/health');
  assert.equal(
    redactUrl('/api/workspaces/123/search?q=private'),
    '/api/workspaces/123/search?[redacted]',
  );
});

/**
 * The reader path of a published link, which defect D42 named.
 *
 * Decision 0046 puts the token in a path segment and the reading ticket in the
 * query, and it states that `/published/` is the whole reader boundary. One
 * rule therefore matches one shape, and no part of a reader address reaches a
 * log line.
 */
await test('redactUrl removes the whole reader path of a published link', () => {
  const token = 'live-published-token';
  const ticket = 'live-reading-ticket';
  assert.equal(redactUrl(`/published/${token}`), '/published/[redacted]');
  assert.equal(
    redactUrl(`/published/${token}?ticket=${ticket}`),
    '/published/[redacted]?[redacted]',
  );
  // The note and the revision of a picture are identifiers, and no log line
  // needs one, so the whole subpath goes with the token.
  const address = `/published/${token}/attachments/note-id/revision-id`;
  assert.equal(redactUrl(address), '/published/[redacted]');
  for (const line of [redactUrl(address), redactPath(address)]) {
    assert.ok(!line.includes(token));
    assert.ok(!line.includes('note-id'));
    assert.ok(!line.includes('revision-id'));
  }
});

await test('redactPath keeps an address that names no secret', () => {
  assert.equal(redactPath('/api/workspaces'), '/api/workspaces');
  // A path that only starts with the word is not the reader boundary.
  assert.equal(redactPath('/publishedxyz'), '/publishedxyz');
});
