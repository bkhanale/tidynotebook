import assert from 'node:assert/strict';
import test from 'node:test';
import { apiKeyFacts, apiKeyRevokeText } from './api-keys.ts';

const now = Date.parse('2026-10-07T12:00:00.000Z');
const key = {
  keyId: 'private-id',
  name: 'My program',
  createdAt: '2026-10-07T11:00:00.000Z',
  expiresAt: '2026-10-08T12:00:00.000Z',
  lastUsedAt: null,
};
await test('a new key shows its expiry and no use, with no storage detail', () => {
  assert.equal(apiKeyFacts(key, now), 'Expires tomorrow. Not used yet.');
  assert.ok(!apiKeyFacts(key, now).includes(key.keyId));
  assert.ok(!apiKeyFacts(key, now).includes(key.expiresAt));
});
await test('an expired key says so at its expiry and shows the last use', () => {
  assert.equal(
    apiKeyFacts(
      {
        ...key,
        expiresAt: new Date(now).toISOString(),
        lastUsedAt: '2026-10-07T11:00:00.000Z',
      },
      now,
    ),
    'Expired. Last used 1 hour ago.',
  );
});
await test('revoke names the program and says how access changes', () => {
  assert.equal(
    apiKeyRevokeText('My program'),
    'The program that uses My program loses access at once. You can create a new key later.',
  );
});
