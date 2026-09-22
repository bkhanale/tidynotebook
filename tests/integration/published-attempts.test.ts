/**
 * The attempt limit over the password of a published link.
 *
 * Two operations take that password: the form of the page, which a browser
 * sends, and the unlock, which answers a reading ticket to a program. A
 * password that a stranger may try is a password that a stranger may guess,
 * so the boundary bounds both of them, and it bounds them together: the two
 * are one attempt group, so a caller that moves between the paths gets the
 * attempts of the group and not the attempts of both. This file proves that,
 * and that the refusal of the limit names no link.
 *
 * The limit itself is the shared plugin of the board row that owns it, and
 * `rate-limit.test.ts` proves its setup and account paths. This file is the
 * published path, and it needs a link with a password, so it starts a
 * deployment of its own with a small limit.
 *
 * Start the service first:
 *
 * ```sh
 * sudo -n docker compose -f compose.test.yaml up -d --wait
 * ```
 */
import assert from 'node:assert/strict';
import { firstSave } from './support/documents.ts';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  configureClient,
  createFile,
  createPublishedLink,
  listWorkspaces,
  openPublishedPage,
  signInWithPassword,
  unlockPublishedLink,
} from '@notesapp/api-client';
import { bootstrapOwner, createApp, loadServerConfig } from '@notesapp/server';
import { createDisposableDatabase } from './support/database.ts';

/** The HTTP response of a generated call, or a clear test failure. */
function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

/** Reads one property of an unknown value without asserting its shape. */
function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/** Turns the Set-Cookie values of an answer into a Cookie request header. */
function cookieHeader(values: readonly string[]): string {
  return values
    .map((entry) => (entry.split(';')[0] ?? '').trim())
    .filter((entry) => entry !== '' && !entry.endsWith('='))
    .join('; ');
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-attempts-'));
const config = loadServerConfig({
  NOTESAPP_ORIGIN: 'http://127.0.0.1',
  NOTESAPP_DATABASE_URL: database.runtimeUrl,
  NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
  NOTESAPP_STORAGE_ROOT: storageRoot,
  NOTESAPP_AUTH_SECRET: 'attempt-limit-secret-value-0123456789abcd',
  NOTESAPP_LOG_LEVEL: 'silent',
  NOTESAPP_MAX_BODY_BYTES: '1048576',
  NOTESAPP_MAX_HEADER_BYTES: '16384',
  NOTESAPP_REQUEST_TIMEOUT_MS: '10000',
  NOTESAPP_UPLOAD_IDLE_TIMEOUT_MS: '5000',
  NOTESAPP_RATE_LIMIT_WINDOW_S: '60',
  NOTESAPP_RATE_LIMIT_MAX: '2',
});

const ownerEmail = 'attempt-owner@notes.invalid';
const ownerPassword = 'a-strong-attempt-password';
await bootstrapOwner({
  config,
  email: ownerEmail,
  name: 'AttemptOwner',
  password: ownerPassword,
});
const app = await createApp(config);
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (address === null || typeof address === 'string')
  throw new Error('The attempt limit server did not bind a TCP port.');
configureClient(`http://127.0.0.1:${String(address.port)}`, undefined);

const signedIn = await signInWithPassword({
  headers: { origin: 'http://127.0.0.1' },
  body: { email: ownerEmail, password: ownerPassword },
});
const cookie = cookieHeader(
  responseOf(signedIn.response).headers.getSetCookie(),
);
assert.ok(cookie.length > 0, 'the test needs a session cookie');
const owner = { origin: 'http://127.0.0.1', cookie };

const listed = await listWorkspaces({ headers: owner });
const workspaceId = listed.data?.workspaces[0]?.workspaceId ?? '';
assert.match(workspaceId, /^[0-9a-f-]{36}$/);

const created = await createFile({
  headers: owner,
  path: { workspaceId },
  body: {
    fileId: randomUUID(),
    revisionId: randomUUID(),
    path: 'notes/guarded/one.md',
    document: firstSave('# Guarded\n\nThe words behind a password.\n'),
    mutationId: randomUUID(),
    deviceId: 'attempt-limit-device',
  },
});
assert.equal(created.error, undefined, JSON.stringify(created.error));

const link = await createPublishedLink({
  headers: owner,
  path: { workspaceId },
  body: {
    scope: { kind: 'folder', path: 'notes/guarded' },
    password: 'a-strong-link-password',
  },
});
const token = link.data?.token ?? '';
assert.match(token, /^[A-Za-z0-9_-]{22,}$/);

await test('the two paths to one password share one bucket of attempts', async () => {
  // Two operations take the password of a link: the form of the page, which a
  // browser sends because a served document holds no script, and the unlock,
  // which answers a reading ticket to a program. `throttleGroup` of
  // `apps/server/src/plugins/register.ts` puts them in one group, so the two
  // together get the attempts of this deployment and not the attempts of both.
  //
  // The defect this covers: the limit plugin built a child store for each
  // route and the store it shipped gave each child a counter of its own, so
  // one caller had four attempts at one password by moving between the paths.
  //
  // The first attempt goes to the form. It answers the page again, with the
  // same words as a link that nobody has opened, because the answer states
  // nothing about the password.
  const page = await openPublishedPage({
    path: { token },
    body: { password: 'not the password' },
  });
  assert.equal(responseOf(page.response).status, 200);
  assert.ok(String(page.data).includes('This link needs a password.'));

  // The second goes to the unlock, which refuses the password itself.
  const unlock = await unlockPublishedLink({
    path: { token },
    body: { password: 'not the password' },
  });
  assert.equal(responseOf(unlock.response).status, 404);

  // Two attempts is the bound of this deployment, and the two paths spent it
  // between them. Both are now refused by the limit, and the refusal names no
  // link and no note, as every refusal of this path does.
  const refusedUnlock = await unlockPublishedLink({
    path: { token },
    body: { password: 'not the password' },
  });
  assert.equal(responseOf(refusedUnlock.response).status, 429);
  assert.equal(readProperty(refusedUnlock.error, 'code'), 'rate_limited');
  assert.ok(!JSON.stringify(refusedUnlock.error).includes(token));

  const refusedPage = await openPublishedPage({
    path: { token },
    body: { password: 'not the password' },
  });
  assert.equal(responseOf(refusedPage.response).status, 429);
  assert.equal(readProperty(refusedPage.error, 'code'), 'rate_limited');
  assert.ok(!JSON.stringify(refusedPage.error).includes(token));
});

await app.close();
await database.destroy();
await rm(storageRoot, { recursive: true, force: true });
