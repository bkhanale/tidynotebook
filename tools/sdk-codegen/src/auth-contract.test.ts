/** Checks of the authentication fragment of the contract. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { authContractPaths } from './auth-contract.ts';

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The statuses that one operation of the fragment declares, by its id. */
function statusesOf(id: string): string[] {
  for (const item of Object.values(authContractPaths())) {
    if (!isRecord(item)) continue;
    for (const operation of Object.values(item)) {
      if (!isRecord(operation) || operation['operationId'] !== id) continue;
      const responses = operation['responses'];
      return isRecord(responses) ? Object.keys(responses) : [];
    }
  }
  throw new Error(`The fragment holds no operation ${id}.`);
}

await test('the fragment holds only session lifecycle operations', () => {
  assert.equal('/api/auth/update-user' in authContractPaths(), false);
  for (const kept of [
    'signInWithPassword',
    'signOut',
    'getAuthSession',
    'requestPasswordReset',
    'resetPassword',
  ])
    assert.ok(!statusesOf(kept).includes('423'), kept);
});
