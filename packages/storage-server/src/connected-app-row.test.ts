import assert from 'node:assert/strict';
import test from 'node:test';
import { connectedAppOf } from './connected-app-row.ts';

await test('grant metadata keeps no secret and refuses unknown access', () => {
  const row = {
    grant_id: 'grant',
    client_id: 'client',
    client_name: 'My app',
    scopes: ['notes:read'],
    last_used_at: null,
  };
  assert.deepEqual(connectedAppOf(row), {
    grantId: 'grant',
    clientId: 'client',
    clientName: 'My app',
    scopes: ['notes:read'],
    lastUsedAt: null,
  });
  const at = new Date('2026-10-14T12:00:00Z');
  assert.equal(
    connectedAppOf({ ...row, last_used_at: at }).lastUsedAt,
    at.toISOString(),
  );
  assert.throws(
    () => connectedAppOf({ ...row, scopes: ['openid'] }),
    /unknown access/,
  );
});
