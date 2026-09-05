/**
 * Rules of the account and workspace use cases.
 *
 * The tests run against an in-memory store, so they check the rules and not a
 * database. The storage integration tests check the same rules again under the
 * runtime database role.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyActor, type Actor, type Role } from '../identity/actor.ts';
import type {
  AccountTransaction,
  AgentTokenInput,
  AgentTokenSummary,
  InvitationInput,
  InvitationSummary,
  Member,
  Preferences,
  TokenScope,
  WorkspaceAdminStore,
  WorkspaceAdminTransaction,
  WorkspaceSummary,
} from './ports.ts';
import {
  acceptInvitation,
  checkTokenScopes,
  createAgentToken,
  createWorkspace,
  deleteWorkspace,
  listMembers,
  listWorkspaces,
  removeMember,
  sessionGrants,
  tokenGrants,
  transferOwnership,
  updateMember,
  updatePreferences,
  updateWorkspace,
} from './service.ts';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const carol = '33333333-3333-4333-8333-333333333333';
const space = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Builds a verified actor with every action of a role in one workspace. */
function actorFor(accountId: string, role: Role, workspaceId = space): Actor {
  const actions = {
    owner: ['read', 'history', 'write', 'share', 'members', 'purge'],
    admin: ['read', 'history', 'write', 'share', 'members'],
    editor: ['read', 'history', 'write'],
    viewer: ['read', 'history'],
  } as const;
  const created = verifyActor(accountId, [
    { workspaceId, actions: [...actions[role]] },
  ]);
  if (!created.ok) throw new Error('the test actor was rejected');
  return created.value;
}

/** One workspace of the in-memory store. */
type Space = {
  name: string;
  personal: boolean;
  members: Map<string, Role>;
  invitations: InvitationSummary[];
  tokens: Map<string, string>;
  audit: string[];
  changes: { accountId: string; removed: boolean }[];
  destroyed: boolean;
  locked: boolean;
};

/** An in-memory store that records what a use case asked it to do. */
type FakeStore = WorkspaceAdminStore & {
  readonly spaces: Map<string, Space>;
  readonly preferences: Map<string, Preferences>;
  readonly tokens: Map<string, AgentTokenSummary & { account: string }>;
  space(id: string): Space;
  seed(id: string, members: readonly (readonly [string, Role])[]): void;
  memberships(accountId: string): { workspaceId: string; role: Role }[];
};

/** Builds one in-memory store. */
function createFakeStore(): FakeStore {
  const spaces = new Map<string, Space>();
  const preferences = new Map<string, Preferences>();
  const tokens = new Map<string, AgentTokenSummary & { account: string }>();

  const space = (id: string): Space => {
    const found = spaces.get(id);
    if (found === undefined) throw new Error(`no workspace ${id}`);
    return found;
  };

  const seed = (
    id: string,
    members: readonly (readonly [string, Role])[],
  ): void => {
    spaces.set(id, {
      name: `workspace ${id.slice(0, 4)}`,
      personal: false,
      members: new Map(members.map(([account, role]) => [account, role])),
      invitations: [],
      tokens: new Map(),
      audit: [],
      changes: [],
      destroyed: false,
      locked: false,
    });
  };

  const memberships = (
    accountId: string,
  ): { workspaceId: string; role: Role }[] =>
    [...spaces.entries()].flatMap(([workspaceId, value]) => {
      const role = value.members.get(accountId);
      return role === undefined ? [] : [{ workspaceId, role }];
    });

  const account = <T>(
    actor: Actor,
    run: (tx: AccountTransaction) => Promise<T>,
  ): Promise<T> => {
    const tx: AccountTransaction = {
      workspaces: (): Promise<readonly WorkspaceSummary[]> =>
        Promise.resolve(
          memberships(actor.accountId).map((entry) => ({
            workspaceId: entry.workspaceId,
            name: space(entry.workspaceId).name,
            role: entry.role,
            personal: space(entry.workspaceId).personal,
          })),
        ),
      memberships: () => Promise.resolve(memberships(actor.accountId)),
      preferences: () =>
        Promise.resolve(
          preferences.get(actor.accountId) ?? { theme: 'system' },
        ),
      savePreferences: (value: Preferences) => {
        preferences.set(actor.accountId, value);
        return Promise.resolve();
      },
      createWorkspace: (input) => {
        seed(input.workspaceId, [[actor.accountId, 'owner']]);
        space(input.workspaceId).name = input.name;
        space(input.workspaceId).locked = true;
        return Promise.resolve();
      },
      lockWorkspace: (workspaceId: string) => {
        space(workspaceId).locked = true;
        return Promise.resolve();
      },
      audit: (workspaceId: string, input) => {
        space(workspaceId).audit.push(input.action);
        return Promise.resolve();
      },
      recordMembershipChange: (workspaceId: string, input) => {
        space(workspaceId).changes.push(input);
        return Promise.resolve();
      },
      openInvitation: (tokenHash: string) => {
        for (const [workspaceId, value] of spaces.entries()) {
          const found = value.tokens.get(tokenHash);
          if (found === undefined) continue;
          const invitation = value.invitations.find(
            (entry) => entry.id === found,
          );
          if (invitation === undefined) continue;
          return Promise.resolve({ workspaceId, email: invitation.email });
        }
        return Promise.resolve(null);
      },
      agentTokens: () =>
        Promise.resolve(
          [...tokens.values()].filter(
            (token) => token.account === actor.accountId,
          ),
        ),
      createAgentToken: (input: AgentTokenInput) => {
        tokens.set(input.id, {
          account: actor.accountId,
          id: input.id,
          name: input.name,
          prefix: input.prefix,
          scopes: input.scopes,
          expiresAt: input.expiresAt,
          createdAt: '2026-09-06T00:00:00.000Z',
          revokedAt: null,
        });
        return Promise.resolve();
      },
      revokeAgentToken: (id: string) => Promise.resolve(tokens.delete(id)),
      claimInvitation: (input) => {
        for (const value of spaces.values()) {
          const found = value.tokens.get(input.tokenHash);
          if (found === undefined) continue;
          value.locked = true;
          value.tokens.delete(input.tokenHash);
          const invitation = value.invitations.find(
            (entry) => entry.id === found,
          );
          if (invitation === undefined || invitation.email !== input.email)
            return Promise.resolve(null);
          value.members.set(actor.accountId, invitation.role);
          return Promise.resolve({
            workspaceId: invitation.workspaceId,
            role: invitation.role,
          });
        }
        return Promise.resolve(null);
      },
    };
    return run(tx);
  };

  const workspace = <T>(
    actor: Actor,
    workspaceId: string,
    run: (tx: WorkspaceAdminTransaction) => Promise<T>,
  ): Promise<T> => {
    const value = space(workspaceId);
    const tx: WorkspaceAdminTransaction = {
      describe: () =>
        Promise.resolve({ name: value.name, personal: value.personal }),
      role: (accountId: string) =>
        Promise.resolve(value.members.get(accountId) ?? null),
      members: (): Promise<readonly Member[]> =>
        Promise.resolve(
          [...value.members.entries()].map(([accountId, role]) => ({
            accountId,
            role,
            email: `${accountId.slice(0, 4)}@notes.invalid`,
            name: null,
          })),
        ),
      invitations: () => Promise.resolve(value.invitations),
      rename: (name: string) => {
        value.name = name;
        return Promise.resolve();
      },
      destroy: () => {
        value.destroyed = true;
        spaces.delete(workspaceId);
        return Promise.resolve();
      },
      setRole: (accountId: string, role: Role) => {
        value.members.set(accountId, role);
        return Promise.resolve();
      },
      removeMember: (accountId: string) =>
        Promise.resolve(value.members.delete(accountId)),
      transferOwnership: (accountId: string, leave: boolean) => {
        value.members.set(accountId, 'owner');
        if (leave) value.members.delete(actor.accountId);
        else value.members.set(actor.accountId, 'admin');
        return Promise.resolve();
      },
      createInvitation: (input: InvitationInput) => {
        value.invitations.push({
          id: input.id,
          workspaceId,
          email: input.email,
          role: input.role,
          expiresAt: input.expiresAt,
          state: 'pending',
        });
        value.tokens.set(input.tokenHash, input.id);
        return Promise.resolve();
      },
      audit: (input) => {
        value.audit.push(input.action);
        return Promise.resolve();
      },
      auditActorHome: (input) => {
        const home = [...spaces.entries()].find(
          ([id, other]) =>
            id !== workspaceId && other.members.has(actor.accountId),
        );
        if (home === undefined) return Promise.resolve(false);
        home[1].audit.push(input.action);
        return Promise.resolve(true);
      },
      recordMembershipChange: (input) => {
        value.changes.push(input);
        return Promise.resolve();
      },
    };
    return run(tx);
  };

  return {
    spaces,
    preferences,
    tokens,
    space,
    seed,
    memberships,
    account,
    workspace,
  };
}

await test('a viewer cannot rename a workspace', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'viewer'],
  ]);
  const result = await updateWorkspace(
    store,
    actorFor(bob, 'viewer'),
    space,
    'renamed',
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.error.code, 'forbidden');
  assert.equal(store.space(space).name.startsWith('workspace'), true);
});

await test('an administrator renames a workspace and it is audited', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'admin'],
  ]);
  const result = await updateWorkspace(
    store,
    actorFor(bob, 'admin'),
    space,
    'renamed',
  );
  assert.equal(result.ok, true);
  assert.equal(store.space(space).name, 'renamed');
  assert.deepEqual(store.space(space).audit, ['workspace.rename']);
});

await test('only the owner deletes a workspace', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'admin'],
  ]);
  store.seed(other, [[alice, 'owner']]);
  const denied = await deleteWorkspace(store, actorFor(bob, 'admin'), space);
  assert.equal(denied.ok, false);
  const allowed = await deleteWorkspace(store, actorFor(alice, 'owner'), space);
  assert.equal(allowed.ok, true);
  assert.equal(store.spaces.has(space), false);
  // The record of the deletion survives, because it was written to another
  // workspace of the same actor.
  assert.deepEqual(store.space(other).audit, ['workspace.delete']);
});

await test('the last owner cannot be removed', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'admin'],
  ]);
  const byAdmin = await removeMember(
    store,
    actorFor(bob, 'admin'),
    space,
    alice,
  );
  assert.equal(byAdmin.ok, false);
  assert.equal(byAdmin.ok ? '' : byAdmin.error.code, 'forbidden');
  assert.equal(store.space(space).members.get(alice), 'owner');
});

await test('an owner is removed only by another owner', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'owner'],
    [carol, 'admin'],
  ]);
  const byAdmin = await removeMember(
    store,
    actorFor(carol, 'admin'),
    space,
    bob,
  );
  assert.equal(byAdmin.ok, false);
  const byOwner = await removeMember(
    store,
    actorFor(alice, 'owner'),
    space,
    bob,
  );
  assert.equal(byOwner.ok, true);
  assert.equal(store.space(space).members.has(bob), false);
  assert.deepEqual(store.space(space).changes, [
    { accountId: bob, removed: true },
  ]);
});

await test('nobody removes or edits their own membership', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'admin'],
  ]);
  const self = await removeMember(store, actorFor(bob, 'admin'), space, bob);
  assert.equal(self.ok, false);
  const promote = await updateMember(
    store,
    actorFor(bob, 'admin'),
    space,
    bob,
    'admin',
  );
  assert.equal(promote.ok, false);
});

await test('a role change never grants or removes the owner role', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'admin'],
    [carol, 'viewer'],
  ]);
  const demote = await updateMember(
    store,
    actorFor(bob, 'admin'),
    space,
    alice,
    'viewer',
  );
  assert.equal(demote.ok, false);
  assert.equal(store.space(space).members.get(alice), 'owner');
  const promote = await updateMember(
    store,
    actorFor(alice, 'owner'),
    space,
    carol,
    'owner' as Role,
  );
  assert.equal(promote.ok, false);
  assert.equal(store.space(space).members.get(carol), 'viewer');
});

await test('a role change to an assignable role is recorded', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [carol, 'viewer'],
  ]);
  const result = await updateMember(
    store,
    actorFor(alice, 'owner'),
    space,
    carol,
    'editor',
  );
  assert.equal(result.ok, true);
  assert.equal(store.space(space).members.get(carol), 'editor');
  assert.deepEqual(store.space(space).changes, [
    { accountId: carol, removed: false },
  ]);
  assert.deepEqual(store.space(space).audit, ['membership.role']);
});

await test('a transfer needs an owner and an existing member', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'admin'],
  ]);
  const byAdmin = await transferOwnership(
    store,
    actorFor(bob, 'admin'),
    space,
    {
      accountId: alice,
      leave: false,
    },
  );
  assert.equal(byAdmin.ok, false);
  const stranger = await transferOwnership(
    store,
    actorFor(alice, 'owner'),
    space,
    { accountId: carol, leave: false },
  );
  assert.equal(stranger.ok, false);
  assert.equal(stranger.ok ? '' : stranger.error.code, 'not_found');
});

await test('a transfer makes the old owner an administrator', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'editor'],
  ]);
  const result = await transferOwnership(
    store,
    actorFor(alice, 'owner'),
    space,
    { accountId: bob, leave: false },
  );
  assert.equal(result.ok, true);
  assert.equal(store.space(space).members.get(bob), 'owner');
  assert.equal(store.space(space).members.get(alice), 'admin');
});

await test('a transfer with leave removes the old owner', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'editor'],
  ]);
  const result = await transferOwnership(
    store,
    actorFor(alice, 'owner'),
    space,
    { accountId: bob, leave: true },
  );
  assert.equal(result.ok, true);
  assert.equal(store.space(space).members.has(alice), false);
  assert.equal(store.space(space).members.get(bob), 'owner');
});

await test('an account sees only its own workspaces', async () => {
  const store = createFakeStore();
  store.seed(space, [[alice, 'owner']]);
  store.seed(other, [[bob, 'owner']]);
  const result = await listWorkspaces(store, actorFor(alice, 'owner'));
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.ok ? result.value.map((entry) => entry.workspaceId) : [],
    [space],
  );
});

await test('a created workspace has its creator as owner', async () => {
  const store = createFakeStore();
  const created = await createWorkspace(
    store,
    actorFor(alice, 'owner', other),
    {
      workspaceId: space,
      name: 'notes',
    },
  );
  assert.equal(created.ok, true);
  assert.equal(store.space(space).members.get(alice), 'owner');
  assert.equal(store.space(space).locked, true);
  assert.deepEqual(store.space(space).changes, [
    { accountId: alice, removed: false },
  ]);
  assert.deepEqual(store.space(space).audit, ['workspace.create']);
});

await test('a viewer reads members but not invitations', async () => {
  const store = createFakeStore();
  store.seed(space, [
    [alice, 'owner'],
    [bob, 'viewer'],
  ]);
  await store.workspace(actorFor(alice, 'owner'), space, (tx) =>
    tx.createInvitation({
      id: 'inv',
      email: 'new@notes.invalid',
      role: 'editor',
      tokenHash: 'hash',
      expiresAt: '2026-10-06T00:00:00.000Z',
    }),
  );
  const seen = await listMembers(store, actorFor(bob, 'viewer'), space);
  assert.equal(seen.ok, true);
  assert.equal(seen.ok ? seen.value.members.length : 0, 2);
  assert.equal(seen.ok ? seen.value.invitations.length : 1, 0);
  const admin = await listMembers(store, actorFor(alice, 'owner'), space);
  assert.equal(admin.ok ? admin.value.invitations.length : 0, 1);
});

await test('an invitation is accepted once and a replay is rejected', async () => {
  const store = createFakeStore();
  store.seed(space, [[alice, 'owner']]);
  await store.workspace(actorFor(alice, 'owner'), space, (tx) =>
    tx.createInvitation({
      id: 'inv',
      email: '2222@notes.invalid',
      role: 'editor',
      tokenHash: 'hash',
      expiresAt: '2026-10-06T00:00:00.000Z',
    }),
  );
  const guest = actorFor(bob, 'viewer', other);
  const first = await acceptInvitation(store, guest, {
    tokenHash: 'hash',
    email: '2222@notes.invalid',
  });
  assert.equal(first.ok, true);
  assert.equal(store.space(space).members.get(bob), 'editor');
  assert.equal(store.space(space).locked, true);
  assert.deepEqual(store.space(space).changes, [
    { accountId: bob, removed: false },
  ]);
  assert.deepEqual(store.space(space).audit, ['membership.accept']);
  const replay = await acceptInvitation(store, guest, {
    tokenHash: 'hash',
    email: '2222@notes.invalid',
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.ok ? '' : replay.error.code, 'not_found');
});

await test('a theme choice outside the union is rejected', async () => {
  const store = createFakeStore();
  const bad = await updatePreferences(store, actorFor(alice, 'owner'), {
    theme: 'neon' as Preferences['theme'],
  });
  assert.equal(bad.ok, false);
  const good = await updatePreferences(store, actorFor(alice, 'owner'), {
    theme: 'dark',
  });
  assert.equal(good.ok, true);
  assert.deepEqual(store.preferences.get(alice), { theme: 'dark' });
});

await test('a token scope cannot exceed the role of its creator', () => {
  const editor = actorFor(alice, 'editor');
  const wider = checkTokenScopes(
    editor,
    [{ workspaceId: space, actions: ['members'] }],
    [{ workspaceId: space, role: 'editor' }],
  );
  assert.equal(wider.ok, false);
  const foreign = checkTokenScopes(
    editor,
    [{ workspaceId: other, actions: ['read'] }],
    [{ workspaceId: space, role: 'editor' }],
  );
  assert.equal(foreign.ok, false);
  const empty = checkTokenScopes(editor, [], []);
  assert.equal(empty.ok, false);
  const fits = checkTokenScopes(
    editor,
    [{ workspaceId: space, actions: ['read', 'write'] }],
    [{ workspaceId: space, role: 'editor' }],
  );
  assert.equal(fits.ok, true);
});

await test('an agent token needs an expiry inside one year', async () => {
  const store = createFakeStore();
  store.seed(space, [[alice, 'owner']]);
  const now = new Date('2026-09-06T00:00:00.000Z');
  const scopes: readonly TokenScope[] = [
    { workspaceId: space, actions: ['read'] },
  ];
  const base = {
    id: 'token-1',
    name: 'agent',
    prefix: 'nsk_abcd',
    secretHash: 'hash',
    scopes,
    now,
  };
  const past = await createAgentToken(store, actorFor(alice, 'owner'), {
    ...base,
    expiresAt: '2026-09-05T00:00:00.000Z',
  });
  assert.equal(past.ok, false);
  const far = await createAgentToken(store, actorFor(alice, 'owner'), {
    ...base,
    expiresAt: '2028-09-06T00:00:00.000Z',
  });
  assert.equal(far.ok, false);
  const fine = await createAgentToken(store, actorFor(alice, 'owner'), {
    ...base,
    expiresAt: '2026-12-06T00:00:00.000Z',
  });
  assert.equal(fine.ok, true);
  assert.equal(store.tokens.size, 1);
});

await test('session grants follow the current role', () => {
  assert.deepEqual(sessionGrants([{ workspaceId: space, role: 'viewer' }]), [
    { workspaceId: space, actions: ['read', 'history'] },
  ]);
});

await test('token grants are cut down to the current role', () => {
  const scopes: readonly TokenScope[] = [
    { workspaceId: space, actions: ['read', 'write'] },
    { workspaceId: other, actions: ['read'] },
  ];
  assert.deepEqual(
    tokenGrants(scopes, [{ workspaceId: space, role: 'viewer' }]),
    [{ workspaceId: space, actions: ['read'] }],
  );
  assert.deepEqual(tokenGrants(scopes, []), []);
});
