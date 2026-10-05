/**
 * The limits of each month across two server instances (record 0193).
 *
 * Each check starts a pair of instances over one database and one bucket of
 * the test MinIO service, as two replicas of one installation run. One
 * instance sends bytes or calls the store, its sums reach the monthly table
 * at its next write, and the other instance then refuses from the shared
 * total before it ever served that account. So each closure here is a
 * closure that the two instances share, past the limit of an account and
 * past each cap of the installation.
 *
 * The totals of the table only grow inside one month, so a cap of a check is
 * the stored total at its start plus one: the first count that passes it is
 * the count of that check.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createFile,
  createInvitation,
  createOwner,
  createPublishedLink,
  createWorkspace,
  exportNote,
  finalizeAttachment,
  getAccount,
  getAttachmentRevision,
  getPublishedAttachment,
  getPublishedPage,
  inspectWorkspaceExport,
  listFiles,
  readOperatorAccount,
  readOperatorTotals,
  registerAccount,
  setOperatorAccountControls,
  startSnapshot,
  startWorkspaceImport,
  uploadAttachment,
} from '@notesapp/api-client';
import { createApp, loadServerConfig } from '@notesapp/server';
import sharp from 'sharp';
import { createDisposableDatabase } from './support/database.ts';
import { firstSave, useDocumentHeaders } from './support/documents.ts';
import { createTestBucket } from './support/object-store.ts';

function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

/** The stable application error code of a failed generated call. */
function codeOf(error: unknown): unknown {
  if (error === null || typeof error !== 'object') return undefined;
  return Object.fromEntries(Object.entries(error))['code'];
}

/** The limit of the month that a failed generated call names. */
function limitOf(error: unknown): unknown {
  if (error === null || typeof error !== 'object') return undefined;
  return Object.fromEntries(Object.entries(error))['limit'];
}

function cookieHeader(values: readonly string[]): string {
  return values
    .map((value) => (value.split(';')[0] ?? '').trim())
    .filter((value) => value !== '' && !value.endsWith('='))
    .join('; ');
}

/** Waits for a state of the shared table that no single answer states. */
async function until(
  check: () => Promise<boolean>,
  what: string,
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The installation never reached the state: ${what}.`);
}

/** The sentence of a link that opens nothing (record 0146). */
const closedSentence = 'This link is not available.';

const database = await createDisposableDatabase();
const bucket = await createTestBucket();
const directory = await mkdtemp(join(tmpdir(), 'notesapp-monthly-test-'));
const operatorToken = `operator-${randomUUID()}-${randomUUID()}`;
const origin = { origin: 'http://127.0.0.1' };
const operator = { authorization: `Bearer ${operatorToken}` };

/** The environment of one instance, with the caps of one check. */
function environment(
  storageRoot: string,
  caps: Readonly<Record<string, string>>,
): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'monthly-limits-test-secret-0123456789',
    NOTESAPP_LOG_LEVEL: 'silent',
    NOTESAPP_MAX_BODY_BYTES: '8388608',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
    NOTESAPP_RATE_LIMIT_MAX: '10000',
    NOTESAPP_OPERATOR_TOKEN: operatorToken,
    ...bucket.environment,
    ...caps,
  };
}

type Instance = {
  readonly app: Awaited<ReturnType<typeof createApp>>;
  readonly baseUrl: string;
};

/**
 * One instance of the installation, with a storage directory of its own, as
 * a replica has a disk of its own.
 */
async function instance(
  caps: Readonly<Record<string, string>> = {},
  writeIntervalMs = 50,
): Promise<Instance> {
  const root = await mkdtemp(join(directory, 'replica-'));
  const app = await createApp(loadServerConfig(environment(root, caps)), {
    usageWriteIntervalMs: writeIntervalMs,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address: string | AddressInfo | null = app.server.address();
  if (address === null || typeof address === 'string')
    throw new Error('The test server did not bind a TCP port.');
  return { app, baseUrl: `http://127.0.0.1:${String(address.port)}` };
}

/** Two instances of one installation with the same caps. */
async function pair(
  caps: Readonly<Record<string, string>> = {},
): Promise<{ one: Instance; two: Instance; close: () => Promise<void> }> {
  const one = await instance(caps);
  const two = await instance(caps);
  return {
    one,
    two,
    close: async () => {
      await one.app.close();
      await two.app.close();
    },
  };
}

// The owner of the installation invites every account of the checks.
let setup = await instance();
const created = await createOwner({
  baseUrl: setup.baseUrl,
  headers: origin,
  body: { email: 'owner@notes.invalid', password: 'owner-password-123456' },
});
assert.equal(responseOf(created.response).status, 201);
const admin = {
  ...origin,
  cookie: cookieHeader(responseOf(created.response).headers.getSetCookie()),
};

type Person = {
  readonly accountId: string;
  readonly headers: { origin: string; cookie: string };
  readonly workspaceId: string;
};

/**
 * A new account with one workspace, made through the setup instance only, so
 * no instance of a check has counted anything for it yet.
 */
async function person(): Promise<Person> {
  const email = `person-${randomUUID()}@notes.invalid`;
  const made = await createInvitation({
    baseUrl: setup.baseUrl,
    headers: admin,
    body: { email },
  });
  const token = new URL(made.data?.link ?? 'http://x/').hash.slice(1);
  const registered = await registerAccount({
    baseUrl: setup.baseUrl,
    headers: origin,
    body: { invitation: token, password: 'person-password-123456' },
  });
  assert.equal(responseOf(registered.response).status, 201);
  const headers = {
    ...origin,
    cookie: cookieHeader(
      responseOf(registered.response).headers.getSetCookie(),
    ),
  };
  const account = await getAccount({ baseUrl: setup.baseUrl, headers });
  const workspace = await createWorkspace({
    baseUrl: setup.baseUrl,
    headers,
    body: { name: 'Monthly' },
  });
  assert.equal(workspace.error, undefined, JSON.stringify(workspace.error));
  return {
    accountId: account.data?.accountId ?? '',
    headers,
    workspaceId: workspace.data?.workspaceId ?? '',
  };
}

/** A published note with one picture, made through the setup instance. */
async function publishedNote(owner: Person): Promise<{
  readonly fileId: string;
  readonly revisionId: string;
  readonly token: string;
}> {
  const picture = await sharp({
    create: {
      width: 24,
      height: 24,
      channels: 3,
      background: { r: 10, g: 90, b: 200 },
    },
  })
    .png()
    .toBuffer();
  const uploaded = await uploadAttachment({
    baseUrl: setup.baseUrl,
    headers: owner.headers,
    path: { workspaceId: owner.workspaceId },
    body: { file: new File([picture], 'pic.png', { type: 'image/png' }) },
  });
  assert.equal(uploaded.error, undefined, JSON.stringify(uploaded.error));
  const revisionId = randomUUID();
  const finalized = await finalizeAttachment({
    baseUrl: setup.baseUrl,
    headers: owner.headers,
    path: {
      workspaceId: owner.workspaceId,
      objectId: uploaded.data?.objectId ?? '',
    },
    body: {
      fileId: randomUUID(),
      revisionId,
      path: 'attachments/pic.png',
      digest: uploaded.data?.digest ?? '',
      mutationId: randomUUID(),
      deviceId: 'monthly-test',
    },
  });
  assert.equal(responseOf(finalized.response).status, 200);
  useDocumentHeaders(owner.headers);
  const fileId = randomUUID();
  const note = await createFile({
    baseUrl: setup.baseUrl,
    headers: owner.headers,
    path: { workspaceId: owner.workspaceId },
    body: {
      fileId,
      path: 'Published.md',
      document: firstSave(
        '# Published\n\nA page that strangers read.\n\n![Picture](attachments/pic.png)\n',
      ),
      revisionId: randomUUID(),
      mutationId: randomUUID(),
      deviceId: 'monthly-test',
    },
  });
  assert.equal(note.error, undefined, JSON.stringify(note.error));
  const link = await createPublishedLink({
    baseUrl: setup.baseUrl,
    headers: owner.headers,
    path: { workspaceId: owner.workspaceId },
    body: { scope: { kind: 'note', fileId } },
  });
  assert.equal(link.error, undefined, JSON.stringify(link.error));
  return { fileId, revisionId, token: link.data?.token ?? '' };
}

/** The page of a link, through one instance. */
async function page(target: Instance, token: string): Promise<string> {
  const answer = await getPublishedPage({
    baseUrl: target.baseUrl,
    path: { token },
  });
  assert.equal(responseOf(answer.response).status, 200);
  return String(answer.data ?? '');
}

/** The address of the picture on a published page, or `null`. */
function pictureAddress(html: string): string | null {
  return (
    /src="(\/published\/[^"]+\/attachments\/[^"]+)"/.exec(html)?.[1] ?? null
  );
}

/** The two identifiers of the address of a published picture. */
function pictureParts(address: string): { fileId: string; revisionId: string } {
  const parts = address.split('?')[0]?.split('/') ?? [];
  return {
    fileId: decodeURIComponent(parts[4] ?? ''),
    revisionId: decodeURIComponent(parts[5] ?? ''),
  };
}

/** The totals of the month of the installation, as the operator reads them. */
async function totals(): Promise<{
  publishedTransferBytes: number;
  downloadBytes: number;
  objectWrites: number;
  objectReads: number;
}> {
  const read = await readOperatorTotals({
    baseUrl: setup.baseUrl,
    headers: operator,
  });
  assert.equal(read.error, undefined, JSON.stringify(read.error));
  const data = read.data;
  assert.ok(data !== undefined);
  return data;
}

/** The usage of one account of the month, as the operator reads it. */
async function usageOf(accountId: string): Promise<{
  publishedTransferBytes: number;
  downloadBytes: number;
}> {
  const read = await readOperatorAccount({
    baseUrl: setup.baseUrl,
    headers: operator,
    path: { accountId },
  });
  assert.equal(read.error, undefined, JSON.stringify(read.error));
  return {
    publishedTransferBytes: read.data?.usage.publishedTransferBytes ?? 0,
    downloadBytes: read.data?.usage.downloadBytes ?? 0,
  };
}

/** Sets the two limits of the month of an account, as the operator. */
async function setLimits(
  accountId: string,
  limits: {
    readonly publishedTransferLimitBytes?: number | null;
    readonly downloadLimitBytes?: number | null;
    readonly standing?: 'active' | 'locked';
  },
): Promise<void> {
  const read = await readOperatorAccount({
    baseUrl: setup.baseUrl,
    headers: operator,
    path: { accountId },
  });
  const written = await setOperatorAccountControls({
    baseUrl: setup.baseUrl,
    headers: operator,
    path: { accountId },
    body: { revision: read.data?.controls.revision ?? 0, ...limits },
  });
  assert.equal(written.error, undefined, JSON.stringify(written.error));
}

/**
 * Writes every count of the setup instance to the table, so a total that a
 * check reads next holds all that the setup sent. A stop writes the sums of
 * its process, and a new setup instance takes its place.
 */
async function settle(): Promise<void> {
  await setup.app.close();
  setup = await instance();
}

await test('past the published transfer limit of an account its links close on both instances', async () => {
  const owner = await person();
  const note = await publishedNote(owner);
  const { one, two, close } = await pair();
  try {
    // One read with no limit states the size of the page.
    const first = await page(one, note.token);
    assert.ok(!first.includes(closedSentence));
    const size = Buffer.byteLength(first, 'utf8');
    await until(
      async () =>
        (await usageOf(owner.accountId)).publishedTransferBytes >= size,
      'the first read is stored',
    );
    const stored = (await usageOf(owner.accountId)).publishedTransferBytes;
    // The limit lets one more page out.
    await setLimits(owner.accountId, {
      publishedTransferLimitBytes: stored + size,
    });
    await until(
      async () => !(await page(one, note.token)).includes(closedSentence),
      'the first instance reads the limit',
    );
    await until(
      async () =>
        (await usageOf(owner.accountId)).publishedTransferBytes >=
        stored + size,
      'the second read is stored',
    );
    // The other instance sent nothing for this account, and closes from the
    // total that the first one wrote.
    const closed = await page(two, note.token);
    assert.ok(closed.includes(closedSentence));
    assert.equal(pictureAddress(closed), null);
    assert.ok(!closed.includes('A page that strangers read.'));
    // The picture of the link takes the one refusal too.
    const picture = await getPublishedAttachment({
      baseUrl: two.baseUrl,
      path: {
        token: note.token,
        fileId: note.fileId,
        revisionId: note.revisionId,
      },
    });
    assert.equal(responseOf(picture.response).status, 404);
    assert.equal(codeOf(picture.error), 'published_link_unavailable');
    // The owner reads the state on the account page.
    const account = await getAccount({
      baseUrl: two.baseUrl,
      headers: owner.headers,
    });
    assert.equal(account.data?.month.publishedPagesClosed, true);
    assert.equal(account.data?.month.downloadsPaused, false);
    assert.ok(
      (account.data?.month.publishedTransferBytes ?? 0) >= stored + size,
    );
    assert.equal(
      account.data?.month.endsAt,
      new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
      ).toISOString(),
    );
    // No limit opens the links again.
    await setLimits(owner.accountId, { publishedTransferLimitBytes: null });
    await until(
      async () => !(await page(two, note.token)).includes(closedSentence),
      'the links open again',
    );
  } finally {
    await close();
  }
});

await test('the links of a locked account show the closed page on both instances', async () => {
  const owner = await person();
  const note = await publishedNote(owner);
  const { one, two, close } = await pair();
  try {
    assert.ok(!(await page(one, note.token)).includes(closedSentence));
    await setLimits(owner.accountId, { standing: 'locked' });
    for (const target of [one, two])
      assert.ok((await page(target, note.token)).includes(closedSentence));
    await setLimits(owner.accountId, { standing: 'active' });
    for (const target of [one, two])
      assert.ok(!(await page(target, note.token)).includes(closedSentence));
  } finally {
    await close();
  }
});

await test('past the download limit of an account an export, an attachment and a snapshot wait', async () => {
  const someone = await person();
  const note = await publishedNote(someone);
  const { one, two, close } = await pair();
  try {
    // Each answer to the session counts as a download of the account.
    const before = await exportNote({
      baseUrl: one.baseUrl,
      headers: someone.headers,
      path: { workspaceId: someone.workspaceId, fileId: note.fileId },
    });
    assert.equal(responseOf(before.response).status, 200);
    await until(
      async () => (await usageOf(someone.accountId)).downloadBytes > 0,
      'the export is stored',
    );
    await setLimits(someone.accountId, {
      downloadLimitBytes: (await usageOf(someone.accountId)).downloadBytes,
    });
    const target = { baseUrl: two.baseUrl, headers: someone.headers };
    const exported = await exportNote({
      ...target,
      path: { workspaceId: someone.workspaceId, fileId: note.fileId },
    });
    assert.equal(responseOf(exported.response).status, 429);
    assert.equal(codeOf(exported.error), 'download_limit');
    assert.equal(limitOf(exported.error), 'downloads');
    assert.equal(
      responseOf(exported.response).headers.get('notesapp-limit'),
      'downloads',
    );
    const retryAfter = Number(
      responseOf(exported.response).headers.get('retry-after'),
    );
    assert.ok(retryAfter >= 1 && retryAfter <= 31 * 24 * 60 * 60);
    const attachment = await getAttachmentRevision({
      ...target,
      path: { workspaceId: someone.workspaceId, revisionId: note.revisionId },
    });
    assert.equal(responseOf(attachment.response).status, 429);
    assert.equal(codeOf(attachment.error), 'download_limit');
    const snapshot = await startSnapshot({
      ...target,
      path: { workspaceId: someone.workspaceId },
      body: { syncVersion: 1 },
    });
    assert.equal(responseOf(snapshot.response).status, 429);
    assert.equal(codeOf(snapshot.error), 'download_limit');
    const check = await inspectWorkspaceExport({
      ...target,
      path: { workspaceId: someone.workspaceId },
    });
    assert.equal(responseOf(check.response).status, 429);
    // The answer of a HEAD has no body, so its header names the limit.
    assert.equal(
      responseOf(check.response).headers.get('notesapp-limit'),
      'downloads',
    );
    // A small answer of the API still answers, so the application works.
    const files = await listFiles({
      ...target,
      path: { workspaceId: someone.workspaceId },
    });
    assert.equal(responseOf(files.response).status, 200);
    const account = await getAccount(target);
    assert.equal(account.data?.month.downloadsPaused, true);
    assert.equal(account.data?.month.uploadsPaused, false);
    // The published page of the account is not a download, so it opens.
    assert.ok(!(await page(two, note.token)).includes(closedSentence));
    await setLimits(someone.accountId, { downloadLimitBytes: null });
    await until(
      async () =>
        responseOf(
          (
            await exportNote({
              ...target,
              path: { workspaceId: someone.workspaceId, fileId: note.fileId },
            })
          ).response,
        ).status === 200,
      'the export answers again',
    );
  } finally {
    await close();
  }
});

await test('past the download cap of the installation every account waits', async () => {
  const someone = await person();
  const other = await person();
  const note = await publishedNote(someone);
  await settle();
  const start = (await totals()).downloadBytes;
  const { one, two, close } = await pair({
    NOTESAPP_DOWNLOAD_CAP_BYTES: String(start + 1),
  });
  try {
    const before = await exportNote({
      baseUrl: one.baseUrl,
      headers: someone.headers,
      path: { workspaceId: someone.workspaceId, fileId: note.fileId },
    });
    assert.equal(responseOf(before.response).status, 200);
    await until(
      async () => (await totals()).downloadBytes > start,
      'the export is stored',
    );
    // Another account, on the other instance, meets the same cap.
    const refused = await inspectWorkspaceExport({
      baseUrl: two.baseUrl,
      headers: other.headers,
      path: { workspaceId: other.workspaceId },
    });
    assert.equal(responseOf(refused.response).status, 429);
    const account = await getAccount({
      baseUrl: two.baseUrl,
      headers: other.headers,
    });
    assert.equal(account.data?.month.downloadsPaused, true);
  } finally {
    await close();
  }
});

await test('past the published transfer cap of the installation every link closes', async () => {
  const owner = await person();
  const note = await publishedNote(owner);
  await settle();
  const start = (await totals()).publishedTransferBytes;
  const { one, two, close } = await pair({
    NOTESAPP_PUBLISHED_TRANSFER_CAP_BYTES: String(start + 1),
  });
  try {
    assert.ok(!(await page(one, note.token)).includes(closedSentence));
    await until(
      async () => (await totals()).publishedTransferBytes > start,
      'the read is stored',
    );
    assert.ok((await page(two, note.token)).includes(closedSentence));
    const account = await getAccount({
      baseUrl: two.baseUrl,
      headers: owner.headers,
    });
    assert.equal(account.data?.month.publishedPagesClosed, true);
  } finally {
    await close();
  }
});

await test('past the object write cap an upload and an import answer storage_busy', async () => {
  const someone = await person();
  await settle();
  const start = (await totals()).objectWrites;
  const { one, two, close } = await pair({
    NOTESAPP_OBJECT_WRITE_CAP: String(start + 1),
  });
  try {
    const picture = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    const file = (): File =>
      new File([picture], 'pic.png', { type: 'image/png' });
    const first = await uploadAttachment({
      baseUrl: one.baseUrl,
      headers: someone.headers,
      path: { workspaceId: someone.workspaceId },
      body: { file: file() },
    });
    assert.equal(responseOf(first.response).status, 201);
    await until(
      async () => (await totals()).objectWrites > start,
      'the write calls are stored',
    );
    const refused = await uploadAttachment({
      baseUrl: two.baseUrl,
      headers: someone.headers,
      path: { workspaceId: someone.workspaceId },
      body: { file: file() },
    });
    assert.equal(responseOf(refused.response).status, 503);
    assert.equal(codeOf(refused.error), 'storage_busy');
    assert.equal(limitOf(refused.error), 'object_writes');
    assert.ok(
      Number(responseOf(refused.response).headers.get('retry-after')) >= 1,
    );
    const imported = await startWorkspaceImport({
      baseUrl: two.baseUrl,
      headers: someone.headers,
      path: { workspaceId: someone.workspaceId },
      body: { size: 1024 },
    });
    assert.equal(responseOf(imported.response).status, 503);
    assert.equal(codeOf(imported.error), 'storage_busy');
    const account = await getAccount({
      baseUrl: two.baseUrl,
      headers: someone.headers,
    });
    assert.equal(account.data?.month.uploadsPaused, true);
    assert.equal(account.data?.month.downloadsPaused, false);
  } finally {
    await close();
  }
});

await test('past the object read cap an attachment waits and a page shows no image', async () => {
  const owner = await person();
  const note = await publishedNote(owner);
  await settle();
  const start = (await totals()).objectReads;
  const { one, two, close } = await pair({
    NOTESAPP_OBJECT_READ_CAP: String(start + 1),
  });
  try {
    const open = await page(two, note.token);
    const address = pictureAddress(open);
    assert.ok(address !== null, 'the page shows its picture');
    const read = await getAttachmentRevision({
      baseUrl: one.baseUrl,
      headers: owner.headers,
      path: { workspaceId: owner.workspaceId, revisionId: note.revisionId },
    });
    assert.equal(responseOf(read.response).status, 200);
    await until(
      async () => (await totals()).objectReads > start,
      'the read call is stored',
    );
    const refused = await getAttachmentRevision({
      baseUrl: two.baseUrl,
      headers: owner.headers,
      path: { workspaceId: owner.workspaceId, revisionId: note.revisionId },
    });
    assert.equal(responseOf(refused.response).status, 429);
    assert.equal(codeOf(refused.error), 'download_limit');
    // The read cap of the server names itself, not the download limit.
    assert.equal(limitOf(refused.error), 'object_reads');
    assert.equal(
      responseOf(refused.response).headers.get('notesapp-limit'),
      'object_reads',
    );
    // The page still opens, with the words of its picture and no address.
    const closed = await page(two, note.token);
    assert.ok(!closed.includes(closedSentence));
    assert.ok(closed.includes('A page that strangers read.'));
    assert.equal(pictureAddress(closed), null);
    const picture = await getPublishedAttachment({
      baseUrl: two.baseUrl,
      path: { token: note.token, ...pictureParts(address) },
    });
    assert.equal(responseOf(picture.response).status, 404);
    const account = await getAccount({
      baseUrl: two.baseUrl,
      headers: owner.headers,
    });
    assert.equal(account.data?.month.imagesPaused, true);
  } finally {
    await close();
  }
});

await test('a stop writes the counts that the process still holds', async () => {
  const owner = await person();
  const note = await publishedNote(owner);
  await settle();
  // An interval that never comes in this check: only the stop writes.
  const slow = await instance({}, 60 * 60 * 1000);
  const before = (await usageOf(owner.accountId)).publishedTransferBytes;
  const html = await page(slow, note.token);
  assert.equal((await usageOf(owner.accountId)).publishedTransferBytes, before);
  await slow.app.close();
  assert.equal(
    (await usageOf(owner.accountId)).publishedTransferBytes,
    before + Buffer.byteLength(html, 'utf8'),
  );
});

await test('with no limit and no cap nothing is refused', async () => {
  const someone = await person();
  const note = await publishedNote(someone);
  const { one, two, close } = await pair();
  try {
    for (const target of [one, two]) {
      assert.ok(!(await page(target, note.token)).includes(closedSentence));
      const exported = await exportNote({
        baseUrl: target.baseUrl,
        headers: someone.headers,
        path: { workspaceId: someone.workspaceId, fileId: note.fileId },
      });
      assert.equal(responseOf(exported.response).status, 200);
      const account = await getAccount({
        baseUrl: target.baseUrl,
        headers: someone.headers,
      });
      assert.deepEqual(
        [
          account.data?.month.publishedPagesClosed,
          account.data?.month.downloadsPaused,
          account.data?.month.uploadsPaused,
          account.data?.month.imagesPaused,
        ],
        [false, false, false, false],
      );
    }
  } finally {
    await close();
  }
});

await setup.app.close();
await bucket.destroy();
await database.destroy();
await rm(directory, { recursive: true, force: true });
