import assert from 'node:assert/strict';
import test from 'node:test';
import { isOAuthGrantLimit } from './oauth-store.ts';

await test('only the fixed grant-limit database refusal maps to the consent message', () => {
  const limit = { code: 'P0001', message: 'oauth_grant_limit' };
  assert.equal(isOAuthGrantLimit(limit), true);
  assert.equal(isOAuthGrantLimit({ cause: { cause: limit } }), true);
  for (const error of [
    null,
    'oauth_grant_limit',
    { code: '23505', message: 'oauth_grant_limit' },
    { code: 'P0001', message: 'other' },
  ])
    assert.equal(isOAuthGrantLimit(error), false);
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  assert.equal(isOAuthGrantLimit(cycle), false);
});
