/** Single-user setup and sign-in checks against real databases. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  configureClient,
  createOwner,
  getAccount,
  getSetupStatus,
  listWorkspaces,
  signInWithPassword,
} from '@notesapp/api-client';
import { bootstrapOwner, createApp, loadServerConfig } from '@notesapp/server';
import { createDisposableDatabase } from './support/database.ts';

function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

function cookieHeader(values: readonly string[]): string {
  return values
    .map((value) => (value.split(';')[0] ?? '').trim())
    .filter((value) => value !== '' && !value.endsWith('='))
    .join('; ');
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-identity-test-'));
const config = loadServerConfig({
  NOTESAPP_ORIGIN: 'http://127.0.0.1',
  NOTESAPP_DATABASE_URL: database.runtimeUrl,
  NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
  NOTESAPP_STORAGE_ROOT: storageRoot,
  NOTESAPP_AUTH_SECRET: 'identity-test-secret-value-0123456789',
  NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost',
  NOTESAPP_LOG_LEVEL: 'silent',
  NOTESAPP_MAX_BODY_BYTES: '8388608',
  NOTESAPP_MAX_HEADER_BYTES: '16384',
  NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
});
const app = await createApp(config);
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${String(address.port)}`;
configureClient(baseUrl, undefined);

let email = '';
let password = '';
let ownerCookie = '';

await test('a new installation reports that setup is required', async () => {
  const result = await getSetupStatus();
  assert.equal(result.error, undefined);
  assert.equal(result.data?.initialized, false);
});

await test('one concurrent setup request creates the only user', async () => {
  const candidates = [
    {
      email: 'owner-a@notes.invalid',
      password: 'owner-a-password-123456',
    },
    {
      email: 'owner-b@notes.invalid',
      password: 'owner-b-password-123456',
    },
  ] as const;
  const results = await Promise.all(
    candidates.map((body) =>
      createOwner({
        headers: { origin: 'http://127.0.0.1' },
        body,
      }),
    ),
  );
  const statuses = results.map((result) => responseOf(result.response).status);
  assert.deepEqual(
    [...statuses].sort((left, right) => left - right),
    [201, 403],
  );
  const winnerIndex = statuses.indexOf(201);
  const loserIndex = statuses.indexOf(403);
  const winner = results[winnerIndex];
  const winnerCredentials = candidates[winnerIndex];
  const loserCredentials = candidates[loserIndex];
  assert.ok(winner !== undefined);
  assert.ok(winnerCredentials !== undefined);
  assert.ok(loserCredentials !== undefined);
  assert.equal(winner.error, undefined, JSON.stringify(winner.error));
  email = winnerCredentials.email;
  password = winnerCredentials.password;
  ownerCookie = cookieHeader(
    responseOf(winner.response).headers.getSetCookie(),
  );
  assert.ok(ownerCookie.length > 0);

  const status = await getSetupStatus();
  assert.equal(status.data?.initialized, true);

  const losingSignIn = await signInWithPassword({
    headers: { origin: 'http://127.0.0.1' },
    body: loserCredentials,
  });
  assert.equal(responseOf(losingSignIn.response).status, 401);
});

await test('setup refuses every later account', async () => {
  const result = await createOwner({
    headers: { origin: 'http://127.0.0.1' },
    body: {
      email: 'second@notes.invalid',
      password: 'second-password-123456',
    },
  });
  assert.equal(responseOf(result.response).status, 403);
});

await test('the owner session has one personal workspace', async () => {
  const headers = { origin: 'http://127.0.0.1', cookie: ownerCookie };
  const account = await getAccount({ headers });
  assert.equal(account.data?.email, email);
  const workspaces = await listWorkspaces({ headers });
  assert.equal(workspaces.data?.workspaces.length, 1);
  assert.equal(workspaces.data?.workspaces[0]?.role, 'owner');
});

await test('the owner can sign in again with the selected password', async () => {
  const result = await signInWithPassword({
    headers: { origin: 'http://127.0.0.1' },
    body: { email, password },
  });
  assert.equal(result.error, undefined);
  assert.ok(cookieHeader(responseOf(result.response).headers.getSetCookie()));
});

await test('no auth answer hands the session token to page script', async () => {
  // BE-22. The browser already holds the token in an HttpOnly cookie. A copy
  // in the answer body would only widen where the secret can leak. The
  // adapter strips it from every auth answer, so a protocol library release
  // that starts returning it cannot widen the surface without this failing.
  const signIn = await signInWithPassword({
    headers: { origin: 'http://127.0.0.1' },
    body: { email, password },
  });
  const signInResponse = responseOf(signIn.response);
  assert.equal(signInResponse.status, 200);
  assert.equal(signIn.error, undefined);
  assert.equal(JSON.stringify(signIn.data).includes('token'), false);
  // The cookie still carries it, so the session works.
  const cookie = cookieHeader(signInResponse.headers.getSetCookie());
  assert.ok(cookie.length > 0);

  const session = await app.inject({
    method: 'GET',
    url: '/api/auth/get-session',
    headers: { origin: 'http://127.0.0.1', cookie },
  });
  assert.equal(session.statusCode, 200);
  const record = JSON.parse(session.body) as {
    session?: Record<string, unknown>;
    token?: unknown;
  };
  assert.ok(record.session !== undefined);
  assert.equal('token' in record.session, false);
  assert.equal('token' in record, false);
  // The parts the client needs are still there.
  assert.ok(typeof record.session.id === 'string');
});

await test('the bootstrap command refuses to create a second account', async () => {
  // BE-23. The pre-check runs outside the write, so the guard that decides is
  // `linkFirstAccount`. It must fail the command instead of linking a second
  // account to a fresh auth user.
  await assert.rejects(
    bootstrapOwner({
      config,
      email: 'bootstrap-second@notes.invalid',
      name: 'Second',
      password: 'bootstrap-second-password-1',
    }),
    /the single user already exists/,
  );
  const workspaces = await listWorkspaces({
    headers: { origin: 'http://127.0.0.1', cookie: ownerCookie },
  });
  assert.equal(workspaces.data?.workspaces.length, 1);
});

await test('the public Better Auth sign-up route is not mounted', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: 'http://127.0.0.1' },
    payload: {
      email: 'bypass@notes.invalid',
      name: 'Bypass',
      password: 'bypass-password-123456',
    },
  });
  assert.equal(response.statusCode, 404);
});

await app.close();
await rm(storageRoot, { recursive: true, force: true });
await database.destroy();
