import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyActor } from './actor.ts';
import {
  listConnectedApps,
  revokeConnectedApp,
  type ConnectedAppRecord,
} from './connected-apps.ts';
import type { WorkspaceAdminStore } from '../workspaces/ports.ts';
const resolved = verifyActor('account', []);
if (!resolved.ok) throw new Error('No test actor');
const actor = resolved.value;
const app: ConnectedAppRecord = {
  grantId: 'grant',
  clientId: 'client',
  clientName: 'My app',
  scopes: ['notes:read'],
  lastUsedAt: null,
};
function fixture(): {
  store: WorkspaceAdminStore;
  held: ConnectedAppRecord[];
} {
  const held: ConnectedAppRecord[] = [];
  const fail = (): never => {
    throw new Error('Not used');
  };
  const store: WorkspaceAdminStore = {
    workspace: fail,
    account: (who, run) => {
      assert.equal(who, actor);
      return run({
        connectedApps: async () => held,
        revokeConnectedApp: async (id) => {
          const index = held.findIndex((entry) => entry.grantId === id);
          if (index < 0) return false;
          held.splice(index, 1);
          return true;
        },
        apiKeys: fail,
        createApiKey: fail,
        revokeApiKey: fail,
        setProfileName: fail,
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
  return { store, held };
}

await test('the account lists and revokes only through its bound transaction', async () => {
  const { store, held } = fixture();
  held.push(app);
  assert.deepEqual(await listConnectedApps(store, actor), {
    ok: true,
    value: [app],
  });
  assert.equal((await revokeConnectedApp(store, actor, app.grantId)).ok, true);
  assert.deepEqual(await listConnectedApps(store, actor), {
    ok: true,
    value: [],
  });
  const missing = await revokeConnectedApp(store, actor, app.grantId);
  assert.ok(!missing.ok);
  assert.equal(missing.error.code, 'not_found');
});
