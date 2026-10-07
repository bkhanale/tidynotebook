/** Personal keys exercise the same served API and current account rules (0208). */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  configureClient,
  createApiKey,
  createFile,
  createInvitation,
  createOwner,
  createWorkspace,
  deleteFile,
  getAccount,
  getFile,
  listApiKeys,
  listFiles,
  listHistory,
  listSessions,
  listWorkspaces,
  purgeFiles,
  registerAccount,
  readOperatorAccount,
  removeOwnAccount,
  restoreFile,
  revokeApiKey,
  revokeOtherSessions,
  updateAccount,
  updateFile,
  updatePreferences,
  updateProfile,
} from '@notesapp/api-client';
import { createApp, loadServerConfig } from '@notesapp/server';
import { createDisposableDatabase, openSession } from './support/database.ts';
import {
  deletionForHead,
  firstSave,
  saveForHead,
  useDocumentHeaders,
} from './support/documents.ts';
import { LogRecorder } from './support/server.ts';
import { apiKeyFacts } from '../../apps/web/src/lib/api-keys.ts';

function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no response.');
  return response;
}
function cookieHeader(values: readonly string[]): string {
  return values
    .map((value) => (value.split(';')[0] ?? '').trim())
    .filter((value) => value !== '' && !value.endsWith('='))
    .join('; ');
}
const database = await createDisposableDatabase();
const root = await mkdtemp(join(tmpdir(), 'notesapp-api-keys-'));
const logs = new LogRecorder();
const operatorToken = `operator-${randomUUID()}-${randomUUID()}`;
const app = await createApp(
  loadServerConfig({
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: root,
    NOTESAPP_AUTH_SECRET: 'api-keys-test-secret-0123456789abcdef',
    NOTESAPP_LOG_LEVEL: 'info',
    NOTESAPP_OPERATOR_TOKEN: operatorToken,
    NOTESAPP_RATE_LIMIT_MAX: '10000',
    NOTESAPP_MAX_BODY_BYTES: '1048576',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
  }),
  { logStream: logs },
);
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (address === null || typeof address === 'string')
  throw new Error('No server port.');
const baseUrl = `http://127.0.0.1:${String(address.port)}`;
configureClient(baseUrl, undefined);
const origin = { origin: 'http://127.0.0.1' };
const ownerResult = await createOwner({
  headers: origin,
  body: { email: 'owner@notes.invalid', password: 'owner-password-123456' },
});
assert.equal(responseOf(ownerResult.response).status, 201);
const owner = {
  ...origin,
  cookie: cookieHeader(responseOf(ownerResult.response).headers.getSetCookie()),
};

async function newPerson(): Promise<{
  headers: Record<string, string>;
  accountId: string;
  password: string;
}> {
  const email = `person-${randomUUID()}@notes.invalid`;
  const password = 'person-password-123456';
  const invitation = await createInvitation({
    headers: owner,
    body: { email },
  });
  assert.equal(invitation.error, undefined, JSON.stringify(invitation.error));
  assert.ok(invitation.data);
  assert.ok(invitation.data.link);
  const registered = await registerAccount({
    headers: origin,
    body: { invitation: new URL(invitation.data.link).hash.slice(1), password },
  });
  assert.equal(responseOf(registered.response).status, 201);
  const headers = {
    ...origin,
    cookie: cookieHeader(
      responseOf(registered.response).headers.getSetCookie(),
    ),
  };
  const account = await getAccount({ headers });
  assert.ok(account.data);
  return { headers, accountId: account.data.accountId, password };
}
async function keyFor(headers: Record<string, string>, name = 'My program') {
  const made = await createApiKey({ headers, body: { name } });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  assert.ok(made.data);
  assert.equal(
    responseOf(made.response).headers.get('cache-control'),
    'no-store',
  );
  return made.data;
}
async function sql(
  text: string,
  values: readonly unknown[] = [],
): Promise<void> {
  const session = await openSession(database.migrationUrl);
  try {
    await session.query(text, [...values]);
  } finally {
    await session.close();
  }
}

await test('a secret is returned once, stored as a digest, and its last use reaches the screen', async () => {
  const person = await newPerson();
  const made = await keyFor(person.headers);
  const rows = await openSession(database.migrationUrl);
  try {
    const stored = await rows.query<{ token_digest: string }>(
      'select token_digest from api_keys where id = $1',
      [made.key.keyId],
    );
    assert.equal(
      stored[0]?.token_digest,
      createHash('sha256').update(made.token).digest('hex'),
    );
    assert.ok(!JSON.stringify(stored).includes(made.token));
  } finally {
    await rows.close();
  }
  const listed = await listApiKeys({ headers: person.headers });
  assert.deepEqual(listed.data?.keys, [made.key]);
  assert.equal(
    responseOf(listed.response).headers.get('cache-control'),
    'no-store',
  );
  assert.ok(!JSON.stringify(listed.data).includes(made.token));
  assert.equal(
    apiKeyFacts(made.key, Date.now()).endsWith('Not used yet.'),
    true,
  );
  const used = await getAccount({
    headers: { authorization: `bearer ${made.token}` },
  });
  assert.equal(used.data?.accountId, person.accountId);
  const afterUse = (await listApiKeys({ headers: person.headers })).data
    ?.keys[0];
  assert.ok(afterUse);
  assert.notEqual(afterUse.lastUsedAt, null);
  assert.ok(logs.lines.length > 0);
  assert.ok(!logs.lines.join('').includes(made.token));
  assert.ok(
    !logs.lines
      .join('')
      .includes(createHash('sha256').update(made.token).digest('hex')),
  );
  assert.ok(apiKeyFacts(afterUse, Date.now()).includes('Last used just now.'));
});

await test('the generated token provider reads and writes without a cookie or an Origin', async () => {
  const person = await newPerson();
  const made = await keyFor(person.headers);
  configureClient(baseUrl, async () => made.token);
  try {
    assert.equal((await getAccount()).data?.accountId, person.accountId);
    const profile = await updateProfile({ body: { name: 'Program owner' } });
    assert.equal(profile.error, undefined);
    assert.equal((await getAccount()).data?.name, 'Program owner');
    assert.equal(
      (await updatePreferences({ body: { spellCheck: false } })).data
        ?.spellCheck,
      false,
    );
    const workspace = await createWorkspace({
      body: { name: 'Program workspace' },
    });
    assert.ok(workspace.data);
    const workspaceId = workspace.data.workspaceId;
    const fileId = randomUUID();
    const revisionId = randomUUID();
    const note = await createFile({
      path: { workspaceId },
      body: {
        fileId,
        revisionId,
        mutationId: randomUUID(),
        deviceId: 'program',
        path: 'program.md',
        document: firstSave('# Program\n'),
      },
    });
    assert.equal(note.error, undefined, JSON.stringify(note.error));
    assert.equal(
      (await listFiles({ path: { workspaceId } })).data?.files[0]?.path,
      'program.md',
    );
    useDocumentHeaders({});
    const changedId = randomUUID();
    const changed = await updateFile({
      path: { workspaceId, fileId },
      headers: {
        'if-match': responseOf(note.response).headers.get('etag') ?? '',
      },
      body: {
        revisionId: changedId,
        mutationId: randomUUID(),
        deviceId: 'program',
        document: await saveForHead(workspaceId, revisionId, '# Changed\n'),
      },
    });
    assert.equal(changed.error, undefined, JSON.stringify(changed.error));
    assert.equal(
      (await listHistory({ path: { workspaceId, fileId } })).data?.revisions
        .length,
      2,
    );
    const removed = await deleteFile({
      path: { workspaceId, fileId },
      headers: {
        'if-match': responseOf(changed.response).headers.get('etag') ?? '',
      },
      body: {
        revisionId: randomUUID(),
        mutationId: randomUUID(),
        deviceId: 'program',
        document: await deletionForHead(workspaceId, changedId),
      },
    });
    assert.equal(removed.error, undefined, JSON.stringify(removed.error));
    const restored = await restoreFile({
      path: { workspaceId, fileId },
      body: {
        revisionId: randomUUID(),
        mutationId: randomUUID(),
        deviceId: 'program',
        clientTime: new Date().toISOString(),
      },
    });
    assert.equal(restored.error, undefined, JSON.stringify(restored.error));
    const head = await getFile({ path: { workspaceId, fileId } });
    assert.ok(head.data);
    assert.ok(head.data.headRevisionId);
    const trashed = await deleteFile({
      path: { workspaceId, fileId },
      headers: {
        'if-match': responseOf(head.response).headers.get('etag') ?? '',
      },
      body: {
        revisionId: randomUUID(),
        mutationId: randomUUID(),
        deviceId: 'program',
        document: await deletionForHead(workspaceId, head.data.headRevisionId),
      },
    });
    assert.equal(trashed.error, undefined, JSON.stringify(trashed.error));
    assert.equal(
      (
        await purgeFiles({
          path: { workspaceId },
          body: { mutationId: randomUUID(), fileIds: [fileId] },
        })
      ).error,
      undefined,
    );
    assert.equal(
      (await listSessions()).data?.sessions.every(
        (session) => !session.current,
      ),
      true,
    );
    assert.equal(
      responseOf((await revokeOtherSessions()).response).status,
      401,
    );
  } finally {
    configureClient(baseUrl, undefined);
  }
});

await test('an explicit invalid credential never falls back to a valid cookie and uses a Bearer challenge', async () => {
  const person = await newPerson();
  for (const authorization of [
    'Bearer invalid',
    `Bearer tnk_${'a'.repeat(43)}`,
    'Basic invalid',
  ]) {
    const result = await getAccount({
      headers: { ...person.headers, authorization },
    });
    assert.equal(responseOf(result.response).status, 401);
    assert.equal(
      responseOf(result.response).headers.get('www-authenticate'),
      'Bearer realm="tidy notebook", error="invalid_token"',
    );
  }
  const missing = await getAccount();
  assert.equal(
    responseOf(missing.response).headers.get('www-authenticate'),
    'Bearer realm="tidy notebook"',
  );
  const cookieWrite = await updateProfile({
    headers: { cookie: person.headers['cookie'] ?? '' },
    body: { name: 'No origin' },
  });
  assert.equal(responseOf(cookieWrite.response).status, 403);
  const key = await keyFor(person.headers);
  const keyWrite = await updateProfile({
    headers: {
      authorization: `Bearer ${key.token}`,
      origin: 'https://other.example.test',
    },
    body: { name: 'Program' },
  });
  assert.equal(responseOf(keyWrite.response).status, 200);
  const urlKey = await app.inject({
    method: 'GET',
    url: `/api/account?token=${key.token}`,
  });
  assert.equal(urlKey.statusCode, 400);
  assert.ok(!urlKey.body.includes(key.token));
});

await test('keys and notes stay within their account and revocation takes effect on the next call', async () => {
  const one = await newPerson();
  const two = await newPerson();
  const key = await keyFor(one.headers);
  assert.equal(
    (await listApiKeys({ headers: two.headers })).data?.keys.length,
    0,
  );
  assert.equal(
    responseOf(
      (
        await revokeApiKey({
          headers: two.headers,
          path: { keyId: key.key.keyId },
        })
      ).response,
    ).status,
    404,
  );
  const workspace = (await listWorkspaces({ headers: two.headers })).data
    ?.workspaces[0];
  assert.ok(workspace);
  assert.equal(
    responseOf(
      (
        await listFiles({
          headers: { authorization: `Bearer ${key.token}` },
          path: { workspaceId: workspace.workspaceId },
        })
      ).response,
    ).status,
    404,
  );
  const selfRevoke = await revokeApiKey({
    headers: { authorization: `Bearer ${key.token}` },
    path: { keyId: key.key.keyId },
  });
  assert.equal(selfRevoke.data?.removed, true);
  assert.equal(
    responseOf(
      (await getAccount({ headers: { authorization: `Bearer ${key.token}` } }))
        .response,
    ).status,
    401,
  );
});

await test('expiry, disable, and password change permanently stop existing keys', async () => {
  const person = await newPerson();
  const expired = await keyFor(person.headers);
  await sql(
    "update api_keys set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = $1",
    [expired.key.keyId],
  );
  assert.equal(
    responseOf(
      (
        await getAccount({
          headers: { authorization: `Bearer ${expired.token}` },
        })
      ).response,
    ).status,
    401,
  );
  const live = await keyFor(person.headers);
  const disable = await updateAccount({
    headers: owner,
    path: { accountId: person.accountId },
    body: { state: 'disabled' },
  });
  assert.equal(disable.error, undefined);
  assert.equal(
    responseOf(
      (await getAccount({ headers: { authorization: `Bearer ${live.token}` } }))
        .response,
    ).status,
    401,
  );
  assert.equal(
    (
      await updateAccount({
        headers: owner,
        path: { accountId: person.accountId },
        body: { state: 'enabled' },
      })
    ).error,
    undefined,
  );
  assert.equal(
    responseOf(
      (await getAccount({ headers: { authorization: `Bearer ${live.token}` } }))
        .response,
    ).status,
    401,
  );
  const other = await newPerson();
  const reset = await keyFor(other.headers);
  await sql(
    "update auth_account set password = password || 'changed' where user_id = (select auth_user_id from account_identities where account_id = $1)",
    [other.accountId],
  );
  assert.equal(
    responseOf(
      (
        await getAccount({
          headers: { authorization: `Bearer ${reset.token}` },
        })
      ).response,
    ).status,
    401,
  );
  assert.equal(
    (await listApiKeys({ headers: other.headers })).data?.keys.length,
    0,
  );
});

await test('a key follows current installation rights and locked accounts retain revoke', async () => {
  const person = await newPerson();
  const key = await keyFor(person.headers);
  const headers = { authorization: `Bearer ${key.token}` };
  const operatorRefusal = await readOperatorAccount({
    headers,
    path: { accountId: person.accountId },
  });
  assert.equal(responseOf(operatorRefusal.response).status, 401);
  assert.equal(
    responseOf(
      (
        await getAccount({
          headers: { authorization: `Bearer ${operatorToken}` },
        })
      ).response,
    ).status,
    401,
  );
  assert.equal(
    responseOf(
      (
        await createInvitation({
          headers,
          body: { email: 'blocked@notes.invalid' },
        })
      ).response,
    ).status,
    403,
  );
  assert.equal(
    (
      await updateAccount({
        headers: owner,
        path: { accountId: person.accountId },
        body: { installationRole: 'administrator' },
      })
    ).error,
    undefined,
  );
  assert.equal(
    responseOf(
      (
        await createInvitation({
          headers,
          body: { email: 'allowed@notes.invalid' },
        })
      ).response,
    ).status,
    201,
  );
  assert.equal(
    (
      await updateAccount({
        headers: owner,
        path: { accountId: person.accountId },
        body: {
          installationRole: 'member',
          controls: {
            revision:
              (await getAccount({ headers })).data?.controls.revision ?? 0,
            standing: 'locked',
          },
        },
      })
    ).error,
    undefined,
  );
  assert.equal(
    responseOf(
      (await createApiKey({ headers, body: { name: 'Blocked key' } })).response,
    ).status,
    423,
  );
  assert.equal((await listApiKeys({ headers })).data?.keys.length, 1);
  assert.equal(
    (await revokeApiKey({ headers, path: { keyId: key.key.keyId } })).data
      ?.removed,
    true,
  );
});

await test('account removal revokes its keys and raw credential rows are closed to runtime and identity roles', async () => {
  const person = await newPerson();
  const key = await keyFor(person.headers);
  assert.equal(
    (
      await removeOwnAccount({
        headers: { authorization: `Bearer ${key.token}` },
        body: { password: person.password },
      })
    ).error,
    undefined,
  );
  assert.equal(
    responseOf(
      (await getAccount({ headers: { authorization: `Bearer ${key.token}` } }))
        .response,
    ).status,
    401,
  );
  for (const url of [database.runtimeUrl, database.authUrl]) {
    const session = await openSession(url);
    try {
      await assert.rejects(
        session.query('select * from api_keys'),
        /permission denied/,
      );
      await assert.rejects(
        session.query('delete from api_keys'),
        /permission denied/,
      );
    } finally {
      await session.close();
    }
  }
});

await test('parallel creation cannot exceed the account bound and a revoked slot can be used', async () => {
  const person = await newPerson();
  const results = await Promise.all(
    Array.from({ length: 28 }, (_, i) =>
      createApiKey({
        headers: person.headers,
        body: { name: `Program ${String(i)}` },
      }),
    ),
  );
  assert.equal(
    results.filter((result) => responseOf(result.response).status === 201)
      .length,
    25,
  );
  assert.equal(
    results.filter((result) => responseOf(result.response).status === 409)
      .length,
    3,
  );
  const list = await listApiKeys({ headers: person.headers });
  assert.equal(list.data?.keys.length, 25);
  const key = list.data?.keys[0];
  assert.ok(key);
  assert.equal(
    (
      await revokeApiKey({
        headers: person.headers,
        path: { keyId: key.keyId },
      })
    ).error,
    undefined,
  );
  await keyFor(person.headers, 'Replacement');
});

await app.close();
await database.destroy();
await rm(root, { recursive: true, force: true });
