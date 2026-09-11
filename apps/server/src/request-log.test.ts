import assert from 'node:assert/strict';
import test from 'node:test';
import { redactUrl } from './request-log.ts';

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
