/**
 * The reset of a forgotten password, through the served composition (record
 * 0141).
 *
 * The server sends every message to a transport of this test, so each check
 * reads what an address receives: the reset link, the notice after a reset,
 * or nothing over the budget of the address. Each check also reads what a
 * person gets: the status, the body, and whether a sign-in works.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  configureClient,
  createInvitation,
  createOwner,
  getAccount,
  getSetupStatus,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
} from '@notesapp/api-client';
import {
  createApp,
  loadServerConfig,
  type MailMessage,
} from '@notesapp/server';
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
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-reset-test-'));
const config = loadServerConfig({
  NOTESAPP_ORIGIN: 'http://127.0.0.1',
  NOTESAPP_DATABASE_URL: database.runtimeUrl,
  NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
  NOTESAPP_STORAGE_ROOT: storageRoot,
  NOTESAPP_AUTH_SECRET: 'password-reset-test-secret-0123456789',
  NOTESAPP_LOG_LEVEL: 'silent',
  NOTESAPP_MAX_BODY_BYTES: '1048576',
  NOTESAPP_MAX_HEADER_BYTES: '16384',
  NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
  NOTESAPP_RATE_LIMIT_MAX: '10000',
  NOTESAPP_BREACH_CHECK: 'off',
});
const sent: MailMessage[] = [];
const app = await createApp(config, {
  mail: {
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  },
});
await app.listen({ host: '127.0.0.1', port: 0 });
const address: string | AddressInfo | null = app.server.address();
if (address === null || typeof address === 'string')
  throw new Error('The test server did not bind a TCP port.');
configureClient(`http://127.0.0.1:${String(address.port)}`, undefined);
const origin = { origin: 'http://127.0.0.1' };

const ownerEmail = 'owner@notes.invalid';
const created = await createOwner({
  headers: origin,
  body: { email: ownerEmail, password: 'owner-password-123456' },
});
assert.equal(responseOf(created.response).status, 201);
const owner = {
  ...origin,
  cookie: cookieHeader(responseOf(created.response).headers.getSetCookie()),
};

/** Waits until a condition holds, checking at each turn of the event loop. */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('The condition never held.');
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

function mailsTo(email: string): MailMessage[] {
  return sent.filter((message) => message.to === email);
}

/** The fragment of the last link of one kind that an address received. */
function lastToken(email: string, path: string): string {
  const link = mailsTo(email)
    .flatMap((message) => message.text.split('\n'))
    .filter((line) => line.startsWith(`http://127.0.0.1${path}#`))
    .at(-1);
  assert.ok(link !== undefined, `no ${path} link reached ${email}`);
  return new URL(link).hash.slice(1);
}

/** Invites and registers one member by the link of its invitation message. */
async function member(password: string): Promise<{
  email: string;
  cookie: string;
}> {
  const email = `member-${randomUUID()}@notes.invalid`;
  const invited = await createInvitation({ headers: owner, body: { email } });
  assert.equal(invited.error, undefined, JSON.stringify(invited.error));
  // With a transport, the link goes by mail and the answer holds none.
  assert.equal(invited.data?.link, null);
  const registered = await registerAccount({
    headers: origin,
    body: { invitation: lastToken(email, '/invitation'), password },
  });
  assert.equal(responseOf(registered.response).status, 201);
  return {
    email,
    cookie: cookieHeader(
      responseOf(registered.response).headers.getSetCookie(),
    ),
  };
}

/**
 * Runs one check against a server of its own over the same database, and
 * stops it after. The stop waits for every message that is still on its way,
 * so the check can count what went and what did not.
 */
async function withServer<T>(
  run: (served: Awaited<ReturnType<typeof createApp>>) => Promise<T>,
): Promise<T> {
  const served = await createApp(config, {
    mail: {
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    },
  });
  try {
    return await run(served);
  } finally {
    await served.close();
  }
}

/** Asks one server for a reset, from one client address. */
async function askResetOf(
  served: Awaited<ReturnType<typeof createApp>>,
  email: string,
  client: string,
): Promise<{ status: number; body: string }> {
  const answer = await served.inject({
    method: 'POST',
    url: '/api/auth/request-password-reset',
    remoteAddress: client,
    headers: {
      host: '127.0.0.1',
      origin: 'http://127.0.0.1',
      'content-type': 'application/json',
    },
    payload: { email },
  });
  return { status: answer.statusCode, body: answer.body };
}

async function signsIn(email: string, password: string): Promise<boolean> {
  const signed = await signInWithPassword({
    headers: origin,
    body: { email, password },
  });
  return responseOf(signed.response).status === 200;
}

async function askReset(email: string): Promise<{
  status: number;
  body: unknown;
}> {
  const asked = await requestPasswordReset({
    headers: origin,
    body: { email },
  });
  return { status: responseOf(asked.response).status, body: asked.data };
}

await test('the sign-in screen offers a reset when the server sends mail', async () => {
  const status = await getSetupStatus();
  assert.equal(status.data?.passwordReset, true);
});

await test('a reset link opens the application and replaces the password', async () => {
  const person = await member('first-password-123456');
  const before = mailsTo(person.email).length;
  const asked = await askReset(person.email);
  assert.equal(asked.status, 200);
  // The answer does not wait for the message, so the test waits for it.
  await until(() => mailsTo(person.email).length === before + 1);
  const [reset] = mailsTo(person.email).slice(before);
  assert.equal(reset?.subject, 'Reset your password on NotesApp at 127.0.0.1');
  const token = lastToken(person.email, '/reset-password');

  const changed = await resetPassword({
    headers: origin,
    body: { token, newPassword: 'second-password-123456' },
  });
  assert.equal(responseOf(changed.response).status, 200);
  assert.equal(await signsIn(person.email, 'first-password-123456'), false);
  assert.equal(await signsIn(person.email, 'second-password-123456'), true);
  // Every session of the account ended with the old password.
  const stale = await getAccount({
    headers: { ...origin, cookie: person.cookie },
  });
  assert.equal(responseOf(stale.response).status, 401);
  // The owner of the address learns that the password changed.
  await until(() => mailsTo(person.email).length === before + 2);
  const notice = mailsTo(person.email).at(-1);
  assert.equal(
    notice?.subject,
    'Your password on NotesApp at 127.0.0.1 changed',
  );
  assert.ok(
    notice?.text.split('\n').includes('http://127.0.0.1/forgot-password'),
  );
  // A link works once.
  const again = await resetPassword({
    headers: origin,
    body: { token, newPassword: 'third-password-1234567' },
  });
  assert.equal(responseOf(again.response).status, 400);
  assert.equal(await signsIn(person.email, 'second-password-123456'), true);
});

await test('a reset for an unknown address answers the same and sends nothing', async () => {
  const person = await member('known-password-123456');
  const unknownEmail = `nobody-${randomUUID()}@notes.invalid`;
  const [known, unknown] = await withServer(async (served) => [
    await askResetOf(served, person.email, '198.51.100.1'),
    await askResetOf(served, unknownEmail, '198.51.100.2'),
  ]);
  assert.deepEqual(unknown, known);
  assert.equal(mailsTo(person.email).at(-1)?.subject.startsWith('Reset'), true);
  assert.equal(mailsTo(unknownEmail).length, 0);
});

await test('one address takes at most three reset messages in an hour', async () => {
  const person = await member('flood-password-1234567');
  const before = mailsTo(person.email).length;
  // Each request comes from another client, so the attempt limit of one
  // client never answers first and the budget of the address is what holds.
  const answers = await withServer(async (served) => {
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1)
      statuses.push(
        (
          await askResetOf(
            served,
            person.email,
            `192.0.2.${String(10 + index)}`,
          )
        ).status,
      );
    return statuses;
  });
  assert.deepEqual(answers, [200, 200, 200, 200, 200, 200]);
  assert.equal(mailsTo(person.email).length - before, 3);
});

await test('a reset answers before its message is sent', async () => {
  // The defect this covers: the answer waited for the mail server, and only
  // an address with an account sends a message, so the time of the answer
  // told a stranger which address has an account.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting: MailMessage[] = [];
  const slow = await createApp(config, {
    mail: {
      send: async (message) => {
        waiting.push(message);
        await held;
      },
    },
  });
  try {
    let timer: NodeJS.Timeout | undefined;
    const answered = await Promise.race([
      slow
        .inject({
          method: 'POST',
          url: '/api/auth/request-password-reset',
          remoteAddress: '198.51.100.7',
          headers: {
            host: '127.0.0.1',
            origin: 'http://127.0.0.1',
            'content-type': 'application/json',
          },
          payload: { email: ownerEmail },
        })
        .then((answer) => answer.statusCode),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, 10_000);
      }),
    ]);
    clearTimeout(timer);
    assert.equal(answered, 200);
    // The message still goes, after the answer.
    await until(() => waiting.length === 1);
    assert.equal(waiting[0]?.to, ownerEmail);
  } finally {
    release();
    await slow.close();
  }
});

await test('an installation with no mail offers no reset', async () => {
  const quiet = await createApp(config, { mail: null });
  try {
    const status = await quiet.inject({
      method: 'GET',
      url: '/api/setup',
      headers: { host: '127.0.0.1' },
    });
    assert.equal(status.statusCode, 200);
    const body: unknown = status.json();
    assert.ok(body !== null && typeof body === 'object');
    assert.equal(Object.fromEntries(Object.entries(body)).passwordReset, false);
  } finally {
    await quiet.close();
  }
});

await app.close();
await database.destroy();
await rm(storageRoot, { recursive: true, force: true });
