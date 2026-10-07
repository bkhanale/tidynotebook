import assert from 'node:assert/strict';
import test from 'node:test';
import { operations, requestValidator, responseValidator } from './index.ts';

await test('key creation has a closed input and returns the secret once', () => {
  const create = operations.find(
    (entry) => String(entry.id) === 'createApiKey',
  );
  assert.ok(create, 'key creation is a contract operation');
  const input = requestValidator(create.id, 'body');
  assert.ok(input);
  assert.equal(input({ name: 'My program', expiresInDays: 90 }), true);
  for (const body of [
    { name: '' },
    { name: '   ' },
    { name: 'a\nb' },
    { name: 'Program', expiresInDays: 0 },
    { name: 'Program', expiresInDays: 366 },
    { name: 'Program', expiresInDays: 1.5 },
    { name: 'Program', accountId: 'another account' },
  ])
    assert.equal(input(body), false, JSON.stringify(body));
  const list = operations.find((entry) => String(entry.id) === 'listApiKeys');
  assert.ok(list);
  const listed = responseValidator(list.id, 200, 'application/json');
  const created = responseValidator(create.id, 201, 'application/json');
  assert.ok(listed);
  assert.ok(created);
  const key = {
    keyId: '00000000-0000-4000-8000-000000000000',
    name: 'My program',
    createdAt: '2026-10-07T00:00:00.000Z',
    expiresAt: '2027-01-05T00:00:00.000Z',
    lastUsedAt: null,
  };
  assert.equal(created({ key, token: `tnk_${'a'.repeat(43)}` }), true);
  assert.equal(created({ key }), false);
  assert.equal(listed({ keys: [key] }), true);
  assert.equal(
    listed({ keys: [{ ...key, token: `tnk_${'a'.repeat(43)}` }] }),
    false,
  );
  assert.equal(
    listed({ keys: [{ ...key, tokenDigest: 'a'.repeat(64) }] }),
    false,
  );
});

await test('every account operation accepts a key except the two browser session operations', () => {
  const cookieOnly = new Set(['openSyncNotices', 'revokeOtherSessions']);
  for (const operation of operations) {
    if (!operation.security.some((entry) => 'sessionCookie' in entry)) continue;
    assert.equal(
      operation.security.some((entry) => 'personalApiKey' in entry),
      !cookieOnly.has(operation.id),
      operation.id,
    );
  }
  const profile = operations.find((entry) => entry.id === 'updateProfile');
  assert.equal(profile?.protocol, null);
});
