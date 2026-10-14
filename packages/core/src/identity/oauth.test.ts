import assert from 'node:assert/strict';
import test from 'node:test';
import {
  oauthClientIdentity,
  oauthConsentScopeAllowed,
  oauthRedirectAddress,
  oauthScopeAllowed,
  oauthGrantCountAllowed,
  maxOAuthGrants,
} from './oauth.ts';

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

await test('only a CIMD document host is a client identity', () => {
  assert.deepEqual(
    oauthClientIdentity('https://metadata.example:8443/client.json'),
    { kind: 'cimd', host: 'metadata.example:8443' },
  );
  assert.deepEqual(
    oauthClientIdentity('https://metadata.example:443/client.json'),
    { kind: 'cimd', host: 'metadata.example' },
  );
  assert.deepEqual(oauthClientIdentity('registered-client'), {
    kind: 'unverified',
  });
  for (const raw of [
    'https://',
    'https://brand.example@evil.example/client',
    'https://metadata.example/client#claim',
    'https://metadata.example/\nclient',
  ])
    assert.deepEqual(oauthClientIdentity(raw), { kind: 'invalid' });
});

await test('loopback addresses are classified for http and https with a visible port', () => {
  for (const scheme of ['http', 'https']) {
    for (const host of ['127.0.0.1', '127.2.3.4', '[::1]', 'localhost'])
      assert.deepEqual(
        oauthRedirectAddress(`${scheme}://${host}:49152/callback`),
        { kind: 'web', host: `${host}:49152`, loopback: true },
      );
  }
  assert.deepEqual(
    oauthRedirectAddress('https://answers.example:8443/callback'),
    { kind: 'web', host: 'answers.example:8443', loopback: false },
  );
  assert.deepEqual(oauthRedirectAddress('https://localhost.example/callback'), {
    kind: 'web',
    host: 'localhost.example',
    loopback: false,
  });
  assert.deepEqual(oauthRedirectAddress('http://2130706433/callback'), {
    kind: 'web',
    host: '127.0.0.1',
    loopback: true,
  });
});

await test('a native scheme is an app and a bad address is refused', () => {
  assert.deepEqual(oauthRedirectAddress('note-client:/callback'), {
    kind: 'native',
  });
  assert.deepEqual(oauthRedirectAddress('note-client://callback'), {
    kind: 'native',
  });
  for (const raw of [
    '',
    '//answers.example/callback',
    'a bad address',
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///tmp/secret',
    'blob:https://answers.example/id',
    'https://brand.example@evil.example/callback',
    'https://answers.example/\ncallback',
  ])
    assert.deepEqual(oauthRedirectAddress(raw), { kind: 'invalid' });
});

await test('only a new grant needs room in the account', () => {
  assert.equal(maxOAuthGrants, 25);
  assert.equal(oauthGrantCountAllowed(maxOAuthGrants - 1, false), true);
  assert.equal(oauthGrantCountAllowed(maxOAuthGrants, false), false);
  assert.equal(oauthGrantCountAllowed(maxOAuthGrants, true), true);
  for (const count of [-1, NaN, Infinity, 0.5])
    assert.equal(oauthGrantCountAllowed(count, true), false);
});
