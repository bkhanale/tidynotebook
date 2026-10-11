import assert from 'node:assert/strict';
import test from 'node:test';
import { apiKeyOf } from './api-key-row.ts';
await test('key metadata omits secrets and keeps unused and used keys distinct', () => {
  const row = {
    key_id: 'key',
    name: 'Program',
    created_at: new Date('2026-10-07T12:00:00Z'),
    expires_at: new Date('2026-11-07T12:00:00Z'),
    last_used_at: null,
    token_digest: 'private',
  };
  const unused = apiKeyOf(row);
  assert.equal(unused.lastUsedAt, null);
  assert.deepEqual(Object.keys(unused), [
    'keyId',
    'name',
    'createdAt',
    'expiresAt',
    'lastUsedAt',
  ]);
  assert.equal(
    apiKeyOf({ ...row, last_used_at: row.created_at }).lastUsedAt,
    '2026-10-07T12:00:00.000Z',
  );
});
