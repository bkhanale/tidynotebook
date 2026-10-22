/** Welcome notes through open registration, activation, and workspace access. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  configureClient,
  createOwner,
  deleteFile,
  getAccount,
  getSignUpChallenge,
  listFiles,
  listWorkspaces,
  purgeFiles,
  readOperatorAccount,
  setOperatorAccountControls,
  signInWithPassword,
  signUpAccount,
  verifyAddress,
} from '@notesapp/api-client';
import { leadingZeroBits, proofInput } from '@notesapp/core';
import {
  createApp,
  loadServerConfig,
  type MailMessage,
} from '@notesapp/server';
import { createDisposableDatabase, openSession } from './support/database.ts';
import { deletionForHead, useDocumentHeaders } from './support/documents.ts';

const origin = { origin: 'http://127.0.0.1' };
const password = 'welcome-note-test-password-123';

function cookie(response: Response | undefined): string {
  assert.ok(response);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

for (const scenario of [
  { standing: 'active', quota: false },
  { standing: 'locked', quota: false },
  { standing: 'locked', quota: true },
] as const) {
  const { standing, quota } = scenario;
  await test(`open registration with ${standing} standing${quota ? ' and a quota refusal' : ''} completes the welcome note once`, async (t) => {
    const database = await createDisposableDatabase();
    const directory = await mkdtemp(join(tmpdir(), 'notesapp-welcome-'));
    const session = await openSession(database.migrationUrl);
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    t.after(async () => {
      await app?.close();
      await session.close();
      await database.destroy();
      await rm(directory, { recursive: true, force: true });
    });
    const operatorToken = randomUUID();
    const sent: MailMessage[] = [];
    app = await createApp(
      loadServerConfig({
        NOTESAPP_ORIGIN: origin.origin,
        NOTESAPP_DATABASE_URL: database.runtimeUrl,
        NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
        NOTESAPP_STORAGE_ROOT: directory,
        NOTESAPP_AUTH_SECRET: 'welcome-note-test-secret-123456789',
        NOTESAPP_NEW_ACCOUNT_STANDING: standing,
        NOTESAPP_OPERATOR_TOKEN: operatorToken,
        NOTESAPP_SIGNUP_DIFFICULTY: '8',
        NOTESAPP_BREACH_CHECK: 'off',
        NOTESAPP_LOG_LEVEL: 'silent',
        NOTESAPP_MAX_BODY_BYTES: '1048576',
        NOTESAPP_MAX_HEADER_BYTES: '16384',
        NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
        NOTESAPP_RATE_LIMIT_MAX: '10000',
      }),
      {
        mail: {
          send: (message) => {
            sent.push(message);
            return Promise.resolve();
          },
        },
      },
    );
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    assert.ok(address !== null && typeof address !== 'string');
    configureClient(`http://127.0.0.1:${String(address.port)}`, undefined);
    const owner = await createOwner({
      headers: origin,
      body: { email: 'owner@notes.invalid', password },
    });
    assert.equal(owner.error, undefined);
    await session.query(
      "update installation_settings set registration_policy = 'open'",
    );

    const email = `welcome-${randomUUID()}@notes.invalid`;
    const challenge = await getSignUpChallenge({ headers: origin });
    assert.ok(challenge.data);
    let solution = '';
    for (let counter = 0; ; counter += 1) {
      solution = counter.toString(36);
      const digest = createHash('sha256')
        .update(proofInput(challenge.data.value, solution))
        .digest();
      if (leadingZeroBits(digest) >= challenge.data.difficulty) break;
    }
    const signedUp = await signUpAccount({
      headers: origin,
      body: {
        email,
        password,
        proof: { challenge: challenge.data.challenge, solution },
      },
    });
    assert.equal(signedUp.error, undefined);
    const message = sent.find((entry) => entry.to === email);
    const link = message?.text
      .split('\n')
      .find((line) => line.startsWith(`${origin.origin}/verify#`));
    assert.ok(link);
    const token = new URL(link).hash.slice(1);
    const verified = await verifyAddress({ headers: origin, body: { token } });
    assert.equal(verified.error, undefined);
    const signedIn = await signInWithPassword({
      headers: origin,
      body: { email, password },
    });
    assert.equal(signedIn.error, undefined);
    const headers = { ...origin, cookie: cookie(signedIn.response) };
    const account = await getAccount({ headers });
    assert.ok(account.data);
    const accountId = account.data.accountId;
    const [before] = await session.query<{
      workspace_id: string;
      completed: boolean;
      count: string;
    }>(
      `select n.workspace_id, n.completed_at is not null as completed,
        (select count(*) from files f where f.workspace_id = n.workspace_id) as count
       from workspace_welcome_notes n join memberships m on m.workspace_id = n.workspace_id
       where m.account_id = $1`,
      [accountId],
    );
    assert.ok(before);
    assert.equal(before.completed, standing === 'active');
    assert.equal(Number(before.count), standing === 'active' ? 1 : 0);
    const workspaceId = before.workspace_id;

    if (standing === 'locked') {
      const locked = await listWorkspaces({ headers });
      assert.equal(locked.error, undefined);
      const [pending] = await session.query<{ completed_at: Date | null }>(
        'select completed_at from workspace_welcome_notes where workspace_id = $1',
        [workspaceId],
      );
      assert.equal(pending?.completed_at, null);
      const operator = { authorization: `Bearer ${operatorToken}` };
      const read = await readOperatorAccount({
        headers: operator,
        path: { accountId },
      });
      assert.ok(read.data);
      const active = await setOperatorAccountControls({
        headers: operator,
        path: { accountId },
        body: {
          revision: read.data.controls.revision,
          standing: 'active',
          removalAt: null,
          ...(quota ? { limitBytes: 1 } : {}),
        },
      });
      assert.equal(active.error, undefined);
      const [afterActivation] = await session.query<{ count: string }>(
        'select count(*) from files where workspace_id = $1',
        [workspaceId],
      );
      assert.equal(
        Number(afterActivation?.count),
        0,
        'activation alone does not write content',
      );
      if (quota) {
        const empty = await listFiles({ headers, path: { workspaceId } });
        assert.equal(empty.error, undefined);
        assert.equal(empty.data?.files.length, 0);
        const [refused] = await session.query<{
          completed_at: Date | null;
          failure_code: string | null;
        }>(
          'select completed_at, failure_code from workspace_welcome_notes where workspace_id = $1',
          [workspaceId],
        );
        assert.equal(refused?.completed_at, null);
        assert.equal(refused?.failure_code, 'quota');
        assert.ok(active.data);
        const raised = await setOperatorAccountControls({
          headers: operator,
          path: { accountId },
          body: {
            revision: active.data.controls.revision,
            limitBytes: 10_000_000,
          },
        });
        assert.equal(raised.error, undefined);
      }
    }

    // The first requests arrive together. Direct file access works without
    // a preceding workspace list, including an existing browser session.
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        index % 2 === 0
          ? listFiles({ headers, path: { workspaceId } })
          : listWorkspaces({ headers }),
      ),
    );
    for (const result of concurrent) assert.equal(result.error, undefined);
    const files = await listFiles({ headers, path: { workspaceId } });
    assert.deepEqual(
      files.data?.files.map((file) => file.path),
      ['Welcome to tidy notebook.md'],
    );
    const file = files.data?.files[0];
    assert.ok(file?.headRevisionId);
    const [completed] = await session.query<{
      completed: boolean;
      revisions: string;
      failure_code: string | null;
    }>(
      `select completed_at is not null as completed, failure_code,
        (select count(*) from revisions where workspace_id = $1) as revisions
       from workspace_welcome_notes where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(completed?.completed, true);
    assert.equal(completed?.failure_code, null);
    assert.equal(Number(completed?.revisions), 1);
    assert.equal(
      (await verifyAddress({ headers: origin, body: { token } })).error,
      undefined,
    );

    useDocumentHeaders(headers);
    const deleted = await deleteFile({
      headers: { ...headers, 'if-match': `"${file.headRevisionId}"` },
      path: { workspaceId, fileId: file.fileId },
      body: {
        revisionId: randomUUID(),
        mutationId: randomUUID(),
        deviceId: randomUUID(),
        document: await deletionForHead(workspaceId, file.headRevisionId),
      },
    });
    assert.equal(deleted.error, undefined);
    await Promise.all(
      Array.from({ length: 4 }, () => listWorkspaces({ headers })),
    );
    assert.equal(
      (await listFiles({ headers, path: { workspaceId } })).data?.files.length,
      0,
    );
    const [afterDelete] = await session.query<{
      count: string;
      completed: boolean;
    }>(
      `select (select count(*) from files where workspace_id = $1) as count,
        completed_at is not null as completed from workspace_welcome_notes where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(
      Number(afterDelete?.count),
      1,
      'only the deleted original remains',
    );
    assert.equal(afterDelete?.completed, true);
    const purged = await purgeFiles({
      headers,
      path: { workspaceId },
      body: {
        mutationId: randomUUID(),
        fileIds: [file.fileId],
      },
    });
    assert.equal(purged.error, undefined);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        listFiles({ headers, path: { workspaceId } }),
      ),
    );
    const [afterPurge] = await session.query<{
      count: string;
      completed: boolean;
    }>(
      `select (select count(*) from files where workspace_id = $1) as count,
        completed_at is not null as completed from workspace_welcome_notes where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(Number(afterPurge?.count), 0);
    assert.equal(afterPurge?.completed, true);
  });
}
