import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyActor } from './actor.ts';
import {
  apiKeyNameProblem,
  apiKeyDaysHold,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  updateProfile,
  type ApiKeyRecord,
  type NewApiKey,
} from './api-keys.ts';
import type { WorkspaceAdminStore } from '../workspaces/ports.ts';
const resolved = verifyActor('11111111-1111-4111-8111-111111111111', []);
if (!resolved.ok) throw new Error('No test actor');
const actor = resolved.value;
const key: ApiKeyRecord = {
  keyId: 'key',
  name: 'Program',
  createdAt: '2026-10-07T12:00:00Z',
  expiresAt: '2026-11-07T12:00:00Z',
  lastUsedAt: null,
};
const input: NewApiKey = {
  keyId: key.keyId,
  name: key.name,
  tokenDigest: 'a'.repeat(64),
  expiresInDays: 30,
};
function fixture(full = false): {
  store: WorkspaceAdminStore;
  names: string[];
  held: ApiKeyRecord[];
  inputs: NewApiKey[];
} {
  const names: string[] = [];
  const held: ApiKeyRecord[] = [];
  const inputs: NewApiKey[] = [];
  const fail = (): never => {
    throw new Error('Not used');
  };
  const store: WorkspaceAdminStore = {
    workspace: fail,
    account: (who, run) => {
      assert.equal(who, actor);
      return run({
        apiKeys: async () => held,
        createApiKey: async (value) => {
          inputs.push(value);
          if (full) return null;
          held.push(key);
          return key;
        },
        revokeApiKey: async (id) => {
          const index = held.findIndex((entry) => entry.keyId === id);
          if (index < 0) return false;
          held.splice(index, 1);
          return true;
        },
        setProfileName: async (name) => {
          names.push(name);
        },
        sessions: fail,
        revokeSession: fail,
        revokeOtherSessions: fail,
        workspaces: fail,
        memberships: fail,
        preferences: fail,
        standing: fail,
        savePreferences: fail,
        themes: fail,
        settings: fail,
        lockSettings: fail,
        addTheme: fail,
        removeTheme: fail,
        consent: fail,
        openHandoff: fail,
        recordConsent: fail,
        createWorkspace: fail,
        lockWorkspace: fail,
        recordMembershipChange: fail,
      });
    },
  };
  return { store, names, held, inputs };
}
await test('a key name has visible text and no hidden or edge characters', () => {
  assert.equal(apiKeyNameProblem('My program'), null);
  assert.equal(apiKeyNameProblem('😀'.repeat(80)), null);
  for (const name of [
    '',
    ' ',
    ' edge',
    'edge ',
    'line\nbreak',
    'hidden\u200bname',
    'a'.repeat(81),
    '\ud800',
  ])
    assert.notEqual(apiKeyNameProblem(name), null);
});
await test('expiry is a whole day within a bounded life', () => {
  assert.ok(apiKeyDaysHold(1));
  assert.ok(apiKeyDaysHold(365));
  for (const days of [0, -1, 366, 1.5, NaN, Infinity])
    assert.equal(apiKeyDaysHold(days), false);
});
await test('the account use cases create, list, and revoke metadata', async () => {
  const { store, inputs } = fixture();
  assert.deepEqual(await createApiKey(store, actor, input), {
    ok: true,
    value: key,
  });
  assert.deepEqual(inputs, [input]);
  assert.deepEqual(await listApiKeys(store, actor), { ok: true, value: [key] });
  assert.equal((await revokeApiKey(store, actor, key.keyId)).ok, true);
  const missing = await revokeApiKey(store, actor, key.keyId);
  assert.ok(!missing.ok);
  assert.equal(missing.error.code, 'not_found');
});
await test('invalid input reaches no store and a full account gets its own refusal', async () => {
  const { store, inputs } = fixture(true);
  for (const value of [
    { ...input, name: '' },
    { ...input, expiresInDays: 366 },
    { ...input, tokenDigest: 'raw-secret' },
  ])
    assert.equal((await createApiKey(store, actor, value)).ok, false);
  assert.equal(inputs.length, 0);
  const full = await createApiKey(store, actor, input);
  assert.ok(!full.ok);
  assert.equal(full.error.code, 'api_key_limit');
});
await test('profile writes use the account port and refuse blank or untrimmed names', async () => {
  const { store, names } = fixture();
  for (const name of ['', ' ', ' name', 'a'.repeat(257)])
    assert.equal((await updateProfile(store, actor, name)).ok, false);
  assert.equal((await updateProfile(store, actor, 'My name')).ok, true);
  assert.deepEqual(names, ['My name']);
  assert.equal((await updateProfile(store, actor, '😀'.repeat(256))).ok, true);
});
