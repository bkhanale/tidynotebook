import assert from 'node:assert/strict';
import test from 'node:test';
import { oauthConsentScopeAllowed, oauthScopeAllowed } from './oauth.ts';

await test('MCP scopes keep read access and refuse other access', () => {
  for (const value of [
    'notes:read',
    'notes:read notes:write',
    'notes:read offline_access',
  ])
    assert.equal(oauthScopeAllowed(value), true);
  for (const value of [
    '',
    'notes:write',
    'openid notes:read',
    'notes:read  notes:write',
  ])
    assert.equal(oauthScopeAllowed(value), false);
});
await test('consent can reduce write to read but cannot add access', () => {
  assert.equal(
    oauthConsentScopeAllowed(
      'notes:read notes:write offline_access',
      'notes:read offline_access',
    ),
    true,
  );
  assert.equal(
    oauthConsentScopeAllowed('notes:read', 'notes:read notes:write'),
    false,
  );
  assert.equal(
    oauthConsentScopeAllowed('notes:read notes:write', 'notes:write'),
    false,
  );
});
