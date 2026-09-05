/**
 * Identity checks against a real server, a real database, and a real OpenID
 * Connect provider.
 *
 * Every application call goes through a generated operation. A request that no
 * generated operation can express, such as the provider redirect or a forged
 * Origin header, uses the framework's in-process `app.inject()` utility, which
 * builds no URL and sends no traffic.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  acceptInvitation,
  configureClient,
  createAgentToken,
  createWorkspace,
  deleteWorkspace,
  getAccount,
  getAuthSession,
  inviteMember,
  listAgentTokens,
  listMembers,
  listWorkspaces,
  removeMember,
  revokeAgentToken,
  signInWithPassword,
  signInWithProvider,
  signOut,
  transferOwnership,
  updateMember,
  updatePreferences,
  updateWorkspace,
} from '@notesapp/api-client';
import { authorize, verifyActor } from '@notesapp/core';
import {
  agentTokenHash,
  bootstrapOwner,
  createAuth,
  createAuthProtocol,
  createHandlers,
  createIdentityAdapter,
  createInvitationAccounts,
  loadServerConfig,
  recoverAccount,
  type MailMessage,
  type ServerConfig,
} from '@notesapp/server';
import {
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import { createDisposableDatabase, openSession } from './support/database.ts';
import { startIdentityProvider } from './support/identity-provider.ts';
import { startTestServer } from './support/server.ts';

/** Reads one property of an unknown value without asserting its shape. */
function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/** The HTTP response of a generated call, or a clear test failure. */
function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

/** Turns the Set-Cookie values of an answer into a Cookie request header. */
function cookieHeader(values: readonly string[]): string {
  return values
    .map((entry) => (entry.split(';')[0] ?? '').trim())
    .filter((entry) => entry !== '' && !entry.endsWith('='))
    .join('; ');
}

/** True for the session cookie, with or without the secure name prefix. */
function isSessionCookie(entry: string): boolean {
  return /^(?:__Secure-)?notesapp_session=/.test(entry);
}

/**
 * The headers of a browser request.
 *
 * A browser always sends `Origin` on a write, and both the protocol library
 * and this deployment check it. Node's own transport does not add the header,
 * so the tests state it explicitly.
 */
function browser(cookie?: string): Record<string, string> {
  return {
    origin: 'https://notes.test',
    ...(cookie === undefined ? {} : { cookie }),
  };
}

/** The stable application error code of a failed generated call. */
function problemCode(error: unknown): string {
  const code = readProperty(error, 'code');
  return typeof code === 'string' ? code : '';
}

const database = await createDisposableDatabase();
const provider = await startIdentityProvider();
const identity = openIdentityStore(database.runtimeUrl);
const content = openWorkspaceStore(database.runtimeUrl, { poolSize: 4 });

/** The environment of the identity test deployment. */
function environment(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'https://notes.test',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: '/tmp',
    NOTESAPP_AUTH_SECRET: 'identity-test-secret-value-0123456789abcd',
    NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost,notes.test',
    NOTESAPP_LOG_LEVEL: 'silent',
    NOTESAPP_MAX_BODY_BYTES: '65536',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '15000',
    NOTESAPP_OIDC_ISSUER_URL: provider.issuer,
    NOTESAPP_OIDC_CLIENT_ID: provider.clientId,
    NOTESAPP_OIDC_CLIENT_SECRET: provider.clientSecret,
    ...overrides,
  };
}

/** Collects the messages that a deployment with a mail transport would send. */
const outbox: MailMessage[] = [];

const config: ServerConfig = loadServerConfig(environment());
// The running server never mounts the sign-up route. Sign-up is reachable
// through the server API only, which is what the invitation path uses.
const auth = createAuth(config, { mail: null, allowSignUp: true });
const adapter = createIdentityAdapter({
  auth: auth.auth,
  identity,
  origin: config.origin,
});
const invitations = createInvitationAccounts(config, {
  auth: auth.auth,
  identity,
  resolveActor: (request) => adapter.resolveActor(request),
});
const server = await startTestServer({
  environment: environment(),
  handlers: (value) =>
    createHandlers(value, undefined, { store: identity, invitations }),
  identity: adapter.resolver,
  protocols: [createAuthProtocol(config, auth.auth)],
});
configureClient(server.baseUrl, undefined);

/** A second deployment whose only difference is a configured mail transport. */
const mailingServer = await startTestServer({
  environment: environment(),
  handlers: (value) =>
    createHandlers(value, undefined, {
      store: identity,
      invitations,
      mail: {
        send: (message: MailMessage): Promise<void> => {
          outbox.push(message);
          return Promise.resolve();
        },
      },
    }),
  identity: adapter.resolver,
  protocols: [createAuthProtocol(config, auth.auth)],
});

const ownerEmail = 'owner@notes.invalid';
const ownerPassword = 'first-owner-password';
/** The password of the first account, which the recovery test replaces. */
let currentOwnerPassword = ownerPassword;

await test('the bootstrap command creates the first account once', async () => {
  const created = await bootstrapOwner({
    config,
    email: ownerEmail,
    name: 'First Owner',
    password: ownerPassword,
  });
  assert.match(created.accountId, /^[0-9a-f-]{36}$/);
  await assert.rejects(
    () =>
      bootstrapOwner({
        config,
        email: 'second@notes.invalid',
        name: 'Second',
        password: 'another-strong-password',
      }),
    /an account already exists/,
  );
});

/** Signs in with a password and returns the cookie header of that session. */
async function signIn(email: string, password: string): Promise<string> {
  const result = await signInWithPassword({
    headers: browser(),
    body: { email, password },
  });
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  const response = responseOf(result.response);
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.length > 0, 'the answer must set a session cookie');
  return cookieHeader(cookies);
}

let ownerCookie = '';
let ownerAccountId = '';
let personalWorkspaceId = '';

await test('a password sign-in sets a secure http only session cookie', async () => {
  const result = await signInWithPassword({
    headers: browser(),
    body: { email: ownerEmail, password: ownerPassword },
  });
  assert.equal(result.error, undefined);
  const cookies = responseOf(result.response).headers.getSetCookie();
  const session = cookies.find(isSessionCookie);
  assert.ok(session !== undefined, cookies.join('\n'));
  assert.match(session, /HttpOnly/i);
  assert.match(session, /Secure/i);
  assert.match(session, /SameSite=Lax/i);
  ownerCookie = cookieHeader(cookies);
});

await test('the first sign-in created a personal workspace', async () => {
  const account = await getAccount({ headers: browser(ownerCookie) });
  assert.equal(account.error, undefined);
  ownerAccountId = account.data?.accountId ?? '';
  assert.match(ownerAccountId, /^[0-9a-f-]{36}$/);
  assert.equal(account.data?.email, ownerEmail);
  assert.equal(account.data?.preferences.theme, 'system');
  const listed = await listWorkspaces({ headers: browser(ownerCookie) });
  assert.equal(listed.error, undefined);
  const workspaces = listed.data?.workspaces ?? [];
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0]?.personal, true);
  assert.equal(workspaces[0]?.role, 'owner');
  personalWorkspaceId = workspaces[0]?.workspaceId ?? '';
});

await test('an operation without a credential answers 401', async () => {
  const result = await getAccount();
  assert.equal(result.data, undefined);
  assert.equal(responseOf(result.response).status, 401);
  assert.equal(problemCode(result.error), 'unauthenticated');
});

await test('public registration is disabled', async () => {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      email: 'intruder@notes.invalid',
      name: 'Intruder',
      password: 'intruder-password-1',
    }),
  });
  // The sign-up endpoint is not in the exact path list of the protocol
  // adapter, so no route serves it at all.
  assert.equal(response.statusCode, 404);
  assert.equal(
    readProperty(JSON.parse(response.body), 'code'),
    'route_not_found',
  );
});

await test('a request body with a wrong media type answers 415', async () => {
  const response = await server.app.inject({
    method: 'PUT',
    url: '/api/account/preferences',
    headers: { 'content-type': 'text/plain', cookie: ownerCookie },
    payload: 'theme=dark',
  });
  assert.equal(response.statusCode, 415);
  assert.equal(
    readProperty(JSON.parse(response.body), 'code'),
    'unsupported_media_type',
  );
});

await test('a cookie write from another origin is refused', async () => {
  const response = await server.app.inject({
    method: 'PUT',
    url: '/api/account/preferences',
    headers: {
      'content-type': 'application/json',
      cookie: ownerCookie,
      origin: 'https://evil.invalid',
    },
    payload: JSON.stringify({ theme: 'dark' }),
  });
  assert.equal(response.statusCode, 403);
  assert.equal(readProperty(JSON.parse(response.body), 'code'), 'forbidden');
});

await test('a cookie write that names no origin is refused', async () => {
  const response = await server.app.inject({
    method: 'PUT',
    url: '/api/account/preferences',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    payload: JSON.stringify({ theme: 'dark' }),
  });
  assert.equal(response.statusCode, 403);
  assert.equal(
    readProperty(JSON.parse(response.body), 'code'),
    'origin_required',
  );
});

await test('a malformed bearer value never falls back to the cookie', async () => {
  const response = await server.app.inject({
    method: 'GET',
    url: '/api/account',
    headers: { cookie: ownerCookie, authorization: 'Bearer not a token' },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(
    readProperty(JSON.parse(response.body), 'code'),
    'unauthenticated',
  );
  const empty = await server.app.inject({
    method: 'GET',
    url: '/api/account',
    headers: { cookie: ownerCookie, authorization: 'Basic abc' },
  });
  assert.equal(empty.statusCode, 401);
});

await test('settings are stored and read back', async () => {
  const stored = await updatePreferences({
    headers: browser(ownerCookie),
    body: { theme: 'dark' },
  });
  assert.equal(stored.error, undefined);
  assert.equal(stored.data?.theme, 'dark');
  const account = await getAccount({ headers: browser(ownerCookie) });
  assert.equal(account.data?.preferences.theme, 'dark');
});

let sharedWorkspaceId = '';

await test('a created workspace has its creator as owner', async () => {
  const created = await createWorkspace({
    headers: browser(ownerCookie),
    body: { name: 'Shared notes' },
  });
  assert.equal(created.error, undefined);
  assert.equal(responseOf(created.response).status, 201);
  assert.equal(created.data?.role, 'owner');
  assert.equal(created.data?.personal, false);
  sharedWorkspaceId = created.data?.workspaceId ?? '';
  const renamed = await updateWorkspace({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId },
    body: { name: 'Team notes' },
  });
  assert.equal(renamed.error, undefined);
  assert.equal(renamed.data?.name, 'Team notes');
});

const memberEmail = 'member@notes.invalid';
const memberPassword = 'second-member-password';
let invitationToken = '';
let memberCookie = '';
let memberAccountId = '';

await test('an administrator invites an address', async () => {
  const invited = await inviteMember({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId },
    body: { email: memberEmail, role: 'editor' },
  });
  assert.equal(invited.error, undefined);
  assert.equal(responseOf(invited.response).status, 201);
  assert.equal(invited.data?.delivered, false);
  invitationToken = invited.data?.token ?? '';
  assert.ok(invitationToken.length >= 32);
  assert.equal(invited.data?.invitation.state, 'pending');
  assert.equal(invited.data?.invitation.role, 'editor');
});

await test('a deployment with mail sends the token instead of returning it', async () => {
  configureClient(mailingServer.baseUrl, undefined);
  const invited = await inviteMember({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId },
    body: { email: 'mailed@notes.invalid', role: 'viewer' },
  });
  configureClient(server.baseUrl, undefined);
  assert.equal(invited.error, undefined);
  assert.equal(invited.data?.delivered, true);
  assert.equal(invited.data?.token, undefined);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0]?.to, 'mailed@notes.invalid');
  // The answer never repeats the token that the message carries.
  assert.equal(
    JSON.stringify(invited.data).includes(
      (outbox[0]?.text ?? '').split('/').at(-1)?.split('\n')[0] ?? 'x',
    ),
    false,
  );
});

await test('an invitation is accepted once and a replay is rejected', async () => {
  // The invited person has no account. The product path creates it from the
  // invitation token, which proves control of the invited address, and signs
  // the new account in.
  const accepted = await acceptInvitation({
    headers: browser(),
    body: { token: invitationToken, password: memberPassword },
  });
  assert.equal(accepted.error, undefined, JSON.stringify(accepted.error));
  assert.equal(accepted.data?.workspaceId, sharedWorkspaceId);
  assert.equal(accepted.data?.role, 'editor');
  const issued = responseOf(accepted.response).headers.getSetCookie();
  assert.ok(issued.some(isSessionCookie), issued.join('\n'));
  memberCookie = cookieHeader(issued);
  const replay = await acceptInvitation({
    headers: browser(memberCookie),
    body: { token: invitationToken },
  });
  assert.equal(replay.data, undefined);
  assert.equal(responseOf(replay.response).status, 404);
  assert.equal(problemCode(replay.error), 'not_found');
  const account = await getAccount({ headers: browser(memberCookie) });
  memberAccountId = account.data?.accountId ?? '';
  assert.match(memberAccountId, /^[0-9a-f-]{36}$/);
  // The new account also received its own personal workspace.
  const spaces = await listWorkspaces({ headers: browser(memberCookie) });
  assert.equal(
    (spaces.data?.workspaces ?? []).filter((entry) => entry.personal).length,
    1,
  );
  // The password still works on its own, so the account is a normal one.
  const again = await signIn(memberEmail, memberPassword);
  assert.ok(again.length > 0);
});

await test('an invitation acceptance needs a session or a password', async () => {
  const invited = await inviteMember({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId },
    body: { email: 'nobody@notes.invalid', role: 'viewer' },
  });
  const token = invited.data?.token ?? '';
  const bare = await acceptInvitation({
    headers: browser(),
    body: { token },
  });
  assert.equal(responseOf(bare.response).status, 401);
  assert.equal(problemCode(bare.error), 'unauthenticated');
  // A signed in account never supplies a password here.
  const both = await acceptInvitation({
    headers: browser(ownerCookie),
    body: { token, password: 'a-password-that-is-long' },
  });
  assert.equal(responseOf(both.response).status, 403);
  // The invited address must not already have an account.
  const taken = await inviteMember({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId },
    body: { email: memberEmail, role: 'viewer' },
  });
  const clash = await acceptInvitation({
    headers: browser(),
    body: {
      token: taken.data?.token ?? '',
      password: 'another-long-password',
    },
  });
  assert.equal(responseOf(clash.response).status, 403);
});

await test('an account never sees another account workspace', async () => {
  const listed = await listWorkspaces({ headers: browser(memberCookie) });
  const ids = (listed.data?.workspaces ?? []).map((entry) => entry.workspaceId);
  assert.equal(ids.includes(sharedWorkspaceId), true);
  assert.equal(ids.includes(personalWorkspaceId), false);
  const hidden = await listMembers({
    headers: browser(memberCookie),
    path: { workspaceId: personalWorkspaceId },
  });
  assert.equal(hidden.data, undefined);
  assert.equal(responseOf(hidden.response).status, 404);
});

await test('an editor cannot change membership', async () => {
  const denied = await updateMember({
    headers: browser(memberCookie),
    path: { workspaceId: sharedWorkspaceId, accountId: ownerAccountId },
    body: { role: 'viewer' },
  });
  assert.equal(denied.data, undefined);
  assert.equal(responseOf(denied.response).status, 403);
  assert.equal(problemCode(denied.error), 'forbidden');
});

await test('the last owner is protected', async () => {
  const demote = await updateMember({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId, accountId: ownerAccountId },
    body: { role: 'viewer' },
  });
  assert.equal(responseOf(demote.response).status, 403);
  const remove = await removeMember({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId, accountId: ownerAccountId },
  });
  assert.equal(responseOf(remove.response).status, 403);
  const members = await listMembers({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId },
  });
  const owners = (members.data?.members ?? []).filter(
    (entry) => entry.role === 'owner',
  );
  assert.equal(owners.length, 1);
});

await test('a role downgrade waits for the open write transaction', async () => {
  const verified = verifyActor(memberAccountId, [
    { workspaceId: sharedWorkspaceId, actions: ['read', 'history', 'write'] },
  ]);
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let announce = (): void => {};
  const holding = new Promise<void>((resolve) => {
    announce = resolve;
  });
  let roleDuringWrite: string | null = null;
  const writing = content.transact(
    verified.value,
    sharedWorkspaceId,
    async (tx) => {
      roleDuringWrite = await tx.role(memberAccountId);
      // The lock is held from here, and the test only continues once it is.
      announce();
      await held;
      return tx.role(memberAccountId);
    },
  );
  await holding;
  let downgradeSettled = false;
  const downgrading = updateMember({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId, accountId: memberAccountId },
    body: { role: 'viewer' },
  }).then((value) => {
    downgradeSettled = true;
    return value;
  });
  // The membership change waits for the same advisory lock. Racing it against
  // a `select pg_advisory_lock` probe would need a third connection, so the
  // proof is that it cannot finish while the write transaction is open: the
  // check below runs after the event loop has drained every pending answer.
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(roleDuringWrite, 'editor');
  assert.equal(downgradeSettled, false);
  release();
  const roleAtCommit = await writing;
  assert.equal(roleAtCommit, 'editor');
  const downgraded = await downgrading;
  assert.equal(downgraded.error, undefined);
  assert.equal(downgraded.data?.role, 'viewer');
  // The next write of the downgraded actor is refused, because the role that
  // the transaction reads is now viewer.
  const after = await content.transact(
    verified.value,
    sharedWorkspaceId,
    (tx) => tx.role(memberAccountId),
  );
  assert.equal(after, 'viewer');
  assert.equal(
    authorize(verified.value, sharedWorkspaceId, 'viewer', 'write').ok,
    false,
  );
});

await test('ownership moves to another member and the old owner stays', async () => {
  const moved = await transferOwnership({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId },
    body: { accountId: memberAccountId },
  });
  assert.equal(moved.error, undefined);
  const roles = new Map(
    (moved.data?.members ?? []).map((entry) => [entry.accountId, entry.role]),
  );
  assert.equal(roles.get(memberAccountId), 'owner');
  assert.equal(roles.get(ownerAccountId), 'admin');
  // Only an owner may remove an owner, and the new owner may now remove the
  // administrator that used to own the workspace.
  const removed = await removeMember({
    headers: browser(memberCookie),
    path: { workspaceId: sharedWorkspaceId, accountId: ownerAccountId },
  });
  assert.equal(removed.error, undefined);
  const gone = await listMembers({
    headers: browser(ownerCookie),
    path: { workspaceId: sharedWorkspaceId },
  });
  assert.equal(responseOf(gone.response).status, 404);
});

let tokenSecret = '';
let tokenId = '';

await test('an agent token cannot be wider than the role that created it', async () => {
  const wide = await createAgentToken({
    headers: browser(ownerCookie),
    body: {
      name: 'too wide',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: [{ workspaceId: sharedWorkspaceId, actions: ['read'] }],
    },
  });
  // The former owner is no longer a member of that workspace at all.
  assert.equal(responseOf(wide.response).status, 403);
  const created = await createAgentToken({
    headers: browser(ownerCookie),
    body: {
      name: 'reader',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: [{ workspaceId: personalWorkspaceId, actions: ['read'] }],
    },
  });
  assert.equal(created.error, undefined);
  assert.equal(responseOf(created.response).status, 201);
  tokenSecret = created.data?.secret ?? '';
  tokenId = created.data?.token.id ?? '';
  assert.ok(tokenSecret.startsWith('nsk_'));
  assert.equal(created.data?.token.prefix, tokenSecret.slice(0, 12));
  const listed = await listAgentTokens({ headers: browser(ownerCookie) });
  assert.equal(listed.data?.tokens.length, 1);
  // The stored record never repeats the secret.
  assert.equal(JSON.stringify(listed.data).includes(tokenSecret), false);
});

await test('a token is refused outside its scope and after revocation', async () => {
  const allowed = await listWorkspaces({
    headers: { authorization: `Bearer ${tokenSecret}` },
  });
  assert.equal(allowed.error, undefined);
  // A token may not manage credentials, even for its own account.
  const denied = await listAgentTokens({
    headers: { authorization: `Bearer ${tokenSecret}` },
  });
  assert.equal(responseOf(denied.response).status, 401);
  // The read scope does not permit a rename.
  const write = await updateWorkspace({
    headers: { authorization: `Bearer ${tokenSecret}` },
    path: { workspaceId: personalWorkspaceId },
    body: { name: 'renamed by an agent' },
  });
  assert.equal(responseOf(write.response).status, 403);
  const revoked = await revokeAgentToken({
    headers: browser(ownerCookie),
    path: { tokenId },
  });
  assert.equal(revoked.error, undefined);
  const after = await listWorkspaces({
    headers: { authorization: `Bearer ${tokenSecret}` },
  });
  assert.equal(responseOf(after.response).status, 401);
  const unknown = await listWorkspaces({
    headers: { authorization: 'Bearer nsk_this-token-was-never-issued' },
  });
  assert.equal(responseOf(unknown.response).status, 401);
});

await test('deleting a workspace keeps a record of the deletion', async () => {
  const created = await createWorkspace({
    headers: browser(ownerCookie),
    body: { name: 'Throwaway' },
  });
  const workspaceId = created.data?.workspaceId ?? '';
  const removed = await deleteWorkspace({
    headers: browser(ownerCookie),
    path: { workspaceId },
  });
  assert.equal(removed.error, undefined);
  const listed = await listWorkspaces({ headers: browser(ownerCookie) });
  assert.equal(
    (listed.data?.workspaces ?? []).some(
      (entry) => entry.workspaceId === workspaceId,
    ),
    false,
  );
  // The audit rows of the deleted workspace are gone with it, so the record of
  // the deletion lives in another workspace of the same actor.
  const session = await openSession(database.runtimeUrl, ownerAccountId);
  try {
    const rows = await session.query<{ workspace_id: string }>(
      `select workspace_id from audit_events
        where action = 'workspace.delete' and target_id = $1`,
      [workspaceId],
    );
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]?.workspace_id, workspaceId);
  } finally {
    await session.close();
  }
});

await test('an expired token is refused', async () => {
  const secret = `nsk_${randomUUID().replaceAll('-', '')}`;
  await identity.account(
    (() => {
      const built = verifyActor(ownerAccountId, [
        { workspaceId: personalWorkspaceId, actions: ['read'] },
      ]);
      if (!built.ok) throw new Error('the actor was rejected');
      return built.value;
    })(),
    (tx) =>
      tx.createAgentToken({
        id: randomUUID(),
        name: 'already expired',
        prefix: secret.slice(0, 12),
        secretHash: agentTokenHash(secret),
        scopes: [{ workspaceId: personalWorkspaceId, actions: ['read'] }],
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
  );
  const result = await listWorkspaces({
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(responseOf(result.response).status, 401);
});

await test('sign-out clears the cookie and revokes the session', async () => {
  const cookie = await signIn(ownerEmail, ownerPassword);
  const out = await signOut({ headers: browser(cookie), body: {} });
  assert.equal(out.error, undefined);
  assert.equal(out.data?.success, true);
  const cleared = responseOf(out.response).headers.getSetCookie();
  assert.ok(
    cleared.some(
      (entry) =>
        isSessionCookie(entry) &&
        (entry.includes('Max-Age=0') ||
          entry.includes('Expires=Thu, 01 Jan 1970')),
    ),
    cleared.join('\n'),
  );
  // The session is gone on the server as well, so the old cookie is useless.
  const after = await getAccount({ headers: browser(cookie) });
  assert.equal(responseOf(after.response).status, 401);
});

/** Signs in through the provider and returns the answer of the callback. */
async function signInThroughProvider(): Promise<{
  status: number;
  cookies: readonly string[];
  location: string;
}> {
  const started = await signInWithProvider({
    headers: browser(),
    body: { provider: 'oidc', callbackURL: '/' },
  });
  assert.equal(started.error, undefined, JSON.stringify(started.error));
  const authorizeUrl = started.data?.url ?? '';
  assert.ok(authorizeUrl.startsWith(provider.issuer), authorizeUrl);
  const startCookies = responseOf(started.response).headers.getSetCookie();
  const target = new URL(authorizeUrl);
  const redirected = await provider.app.inject({
    method: 'GET',
    url: `${target.pathname}${target.search}`,
  });
  assert.equal(redirected.statusCode, 302);
  const callback = new URL(redirected.headers.location ?? '');
  const answer = await server.app.inject({
    method: 'GET',
    url: `${callback.pathname}${callback.search}`,
    headers: { cookie: cookieHeader(startCookies) },
  });
  const raw = answer.headers['set-cookie'];
  return {
    status: answer.statusCode,
    cookies: raw === undefined ? [] : Array.isArray(raw) ? raw : [raw],
    location: String(answer.headers.location ?? ''),
  };
}

let providerCookie = '';

await test('a provider sign-in creates its own account', async () => {
  provider.setMode('valid');
  provider.setIdentity({
    subject: 'subject-1',
    email: 'oidc@notes.invalid',
    name: 'Oidc Person',
  });
  const result = await signInThroughProvider();
  assert.equal(result.status, 302, result.location);
  assert.ok(result.cookies.some(isSessionCookie), result.cookies.join('\n'));
  assert.equal(result.location.includes('error'), false, result.location);
  providerCookie = cookieHeader(result.cookies);
  const account = await getAccount({ headers: browser(providerCookie) });
  assert.equal(account.error, undefined);
  assert.equal(account.data?.email, 'oidc@notes.invalid');
  assert.notEqual(account.data?.accountId, ownerAccountId);
  const listed = await listWorkspaces({
    headers: browser(providerCookie),
  });
  assert.equal(listed.data?.workspaces.length, 1);
  assert.equal(listed.data?.workspaces[0]?.personal, true);
});

await test('a matching address never merges two accounts', async () => {
  provider.setMode('valid');
  provider.setIdentity({
    subject: 'subject-2',
    email: ownerEmail,
    name: 'Same Address',
  });
  const result = await signInThroughProvider();
  // The address of the local owner is already taken, and this provider
  // identity is a different subject, so no session is issued for that account.
  const cookies = result.cookies.filter(isSessionCookie);
  assert.equal(cookies.length, 0, result.cookies.join('\n'));
  const stored = await identity.accountOf('subject-2');
  assert.equal(stored, null);
});

for (const mode of [
  'wrong-nonce',
  'wrong-issuer',
  'wrong-audience',
  'bad-signature',
] as const) {
  await test(`a provider answer with a ${mode} is refused`, async () => {
    provider.setMode(mode);
    provider.setIdentity({
      subject: `subject-${mode}`,
      email: `${mode}@notes.invalid`,
      name: 'Refused',
    });
    const result = await signInThroughProvider();
    const cookies = result.cookies.filter(isSessionCookie);
    assert.equal(cookies.length, 0, result.cookies.join('\n'));
  });
}

await test('the operator recovery command refuses under an oidc policy', async () => {
  const strict = loadServerConfig(
    environment({ NOTESAPP_OIDC_REQUIRED: 'true' }),
  );
  await assert.rejects(
    () =>
      recoverAccount({
        config: strict,
        email: ownerEmail,
        password: 'a-brand-new-password',
      }),
    /requires the configured provider/,
  );
  await assert.rejects(
    () =>
      bootstrapOwner({
        config: strict,
        email: 'another@notes.invalid',
        name: 'Another',
        password: 'a-brand-new-password',
      }),
    /requires the configured provider/,
  );
});

await test('the operator recovery command replaces a password', async () => {
  const replacement = 'a-recovered-password';
  const before = await signIn(ownerEmail, ownerPassword);
  const recovered = await recoverAccount({
    config,
    email: ownerEmail,
    password: replacement,
  });
  assert.equal(recovered.accountId, ownerAccountId);
  // Every session of that account is revoked by the change.
  const stale = await getAccount({ headers: browser(before) });
  assert.equal(responseOf(stale.response).status, 401);
  const old = await signInWithPassword({
    headers: browser(),
    body: { email: ownerEmail, password: ownerPassword },
  });
  assert.equal(old.data, undefined);
  const fresh = await signIn(ownerEmail, replacement);
  assert.ok(fresh.length > 0);
  ownerCookie = fresh;
  currentOwnerPassword = replacement;
});

await test('an auth endpoint rejects a body outside its contract', async () => {
  for (const [url, payload] of [
    ['/api/auth/sign-in/email', { email: 'a@b.invalid' }],
    ['/api/auth/sign-in/social', { provider: 'oidc', extra: 1 }],
    ['/api/auth/request-password-reset', { email: 12 }],
    ['/api/auth/reset-password', { newPassword: 'short' }],
    ['/api/auth/sign-out', { unexpected: true }],
  ] as const) {
    const response = await server.app.inject({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/json',
        origin: 'https://notes.test',
      },
      payload: JSON.stringify(payload),
    });
    assert.equal(response.statusCode, 400, url);
    assert.equal(
      readProperty(JSON.parse(response.body), 'code'),
      'invalid_request',
      url,
    );
  }
});

await test('an auth endpoint rejects a wrong request media type', async () => {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { 'content-type': 'text/plain', origin: 'https://notes.test' },
    payload: 'email=a@b.invalid',
  });
  assert.equal(response.statusCode, 415);
});

await test('the session answer never carries the session token', async () => {
  const cookie = await signIn(ownerEmail, currentOwnerPassword);
  const current = await getAuthSession({ headers: browser(cookie) });
  assert.equal(current.error, undefined);
  const raw = JSON.stringify(current.data);
  assert.equal(raw.includes('"token"'), false, raw);
  // The answer still matches its declared schema, which the boundary checked
  // before it was sent.
  assert.equal(typeof readProperty(current.data, 'session'), 'object');
  const anonymous = await getAuthSession();
  assert.equal(responseOf(anonymous.response).status, 200);
  assert.equal(anonymous.data ?? null, null);
});

await mailingServer.close();
await server.close();
await auth.close();
await content.close();
await identity.close();
await provider.close();
await database.destroy();
