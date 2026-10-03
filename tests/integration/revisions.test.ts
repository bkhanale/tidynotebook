/**
 * File, revision, and changeset checks against a real server, a real database,
 * and real sessions.
 *
 * Every application call goes through a generated operation. A request that no
 * generated operation can express, such as a wrong request media type, uses
 * the framework's in-process `app.inject()` utility, which builds no URL and
 * sends no traffic. Rules that only the database can create, such as a purge
 * marker or a low storage quota, are set up with the migration role.
 *
 * Start the database service first:
 *
 * ```sh
 * sudo -n docker compose -f compose.test.yaml up -d --wait
 * ```
 */
import assert from 'node:assert/strict';
import {
  emptyDocument,
  firstSave,
  saveForHead,
  saveOf,
  deletionForHead,
  useDocumentHeaders,
} from './support/documents.ts';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  commitChangeset,
  configureClient,
  createFile,
  deleteFile,
  getAccount,
  getFile,
  getRevision,
  listFiles,
  listWorkspaces,
  signInWithPassword,
  updateFile,
} from '@notesapp/api-client';
import { acceptWithDocuments, contentDigest } from '@notesapp/core';
import { replaceDocumentText, startDocument } from '@notesapp/note-document';
import {
  bootstrapOwner,
  createAuth,
  createAuthPool,
  createAuthProtocol,
  createHandlers,
  createIdentityAdapter,
  loadServerConfig,
  type ServerConfig,
  sessionAllowedBy,
} from '@notesapp/server';
import {
  createDocumentService,
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import {
  changeset,
  createDisposableDatabase,
  markdown,
  memberActor,
  openSession,
  revision,
  seedWorkspace,
  limitAccountTo,
} from './support/database.ts';
import { startTestServer } from './support/server.ts';
import { noteRefusalSentence } from '../../apps/web/src/lib/parked-saves.ts';

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

/** The stable application error code of a failed generated call. */
function problemCode(error: unknown): string {
  const code = readProperty(error, 'code');
  return typeof code === 'string' ? code : '';
}

/** The explanation of one problem answer. */
function problemDetail(error: unknown): string {
  const detail = readProperty(error, 'detail');
  return typeof detail === 'string' ? detail : '';
}

/** The file identifiers that a problem names. */
function problemFiles(error: unknown): readonly string[] {
  const value = readProperty(error, 'fileIds');
  if (!Array.isArray(value)) return [];
  return value.filter((entry: unknown) => typeof entry === 'string');
}

/** Turns the Set-Cookie values of an answer into a Cookie request header. */
function cookieHeader(values: readonly string[]): string {
  return values
    .map((entry) => (entry.split(';')[0] ?? '').trim())
    .filter((entry) => entry !== '' && !entry.endsWith('='))
    .join('; ');
}

/** The headers of a browser request. A write also names the origin. */
function browser(cookie: string): Record<string, string> {
  return { origin: 'http://127.0.0.1', cookie };
}

const database = await createDisposableDatabase();
const identity = openIdentityStore(database.runtimeUrl);
const content = openWorkspaceStore(
  database.runtimeUrl,
  createDocumentService(),
  { poolSize: 4 },
);

/** The environment of this test deployment. */
function environment(): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: '/tmp',
    NOTESAPP_AUTH_SECRET: 'revision-test-secret-value-0123456789abcd',
    NOTESAPP_ADDITIONAL_ORIGINS: 'http://localhost',
    NOTESAPP_LOG_LEVEL: 'silent',
    // A folder change of 1000 files is one request, so the body limit has to
    // hold it.
    NOTESAPP_MAX_BODY_BYTES: '8388608',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
  };
}

const config: ServerConfig = loadServerConfig(environment());
const authPool = createAuthPool(config);
const auth = createAuth(
  config,
  { mail: null, sessionAllowed: sessionAllowedBy(identity) },
  authPool,
);
const adapter = createIdentityAdapter({
  auth: auth.auth,
  identity,
  servedOrigins: config.servedOrigins,
});
const server = await startTestServer({
  environment: environment(),
  handlers: (value) =>
    createHandlers(value, undefined, { store: identity, content }),
  identity: adapter.resolver,
  protocols: [createAuthProtocol(config, auth.auth)],
});
configureClient(server.baseUrl, undefined);

const ownerEmail = 'writer@notes.invalid';
const ownerPassword = 'a-strong-first-password';
await bootstrapOwner({
  config,
  email: ownerEmail,
  name: 'Writer',
  password: ownerPassword,
});

const signedIn = await signInWithPassword({
  headers: { origin: 'http://127.0.0.1' },
  body: { email: ownerEmail, password: ownerPassword },
});
const cookie = cookieHeader(
  responseOf(signedIn.response).headers.getSetCookie(),
);
assert.ok(cookie.length > 0, 'the test needs a session cookie');

useDocumentHeaders(browser(cookie));
const account = await getAccount({ headers: browser(cookie) });
const ownerAccountId = account.data?.accountId ?? '';
assert.match(ownerAccountId, /^[0-9a-f-]{36}$/);

const listed = await listWorkspaces({ headers: browser(cookie) });
const workspaceId = listed.data?.workspaces[0]?.workspaceId ?? '';
assert.match(workspaceId, /^[0-9a-f-]{36}$/);

/** The identifiers that every write of this test carries. */
function ids(): { revisionId: string; mutationId: string; deviceId: string } {
  return {
    revisionId: randomUUID(),
    mutationId: randomUUID(),
    deviceId: 'integration-device',
  };
}

/** Creates one file and returns its identifiers and its entity tag. */
async function newFile(
  path: string,
  text = `# ${path}\n`,
  workspace = workspaceId,
): Promise<{ fileId: string; revisionId: string; tag: string }> {
  const fileId = randomUUID();
  const created = await createFile({
    headers: browser(cookie),
    path: { workspaceId: workspace },
    body: { fileId, path, document: firstSave(text), ...ids() },
  });
  assert.equal(created.error, undefined, JSON.stringify(created.error));
  const response = responseOf(created.response);
  assert.equal(response.status, 201);
  return {
    fileId,
    revisionId: created.data?.revision.revisionId ?? '',
    tag: response.headers.get('etag') ?? '',
  };
}

/** One submitted Markdown revision of a changeset request. */
async function revisionBody(seed: {
  readonly fileId: string;
  readonly path: string;
  readonly text?: string;
  readonly parents?: readonly string[];
  readonly deleted?: boolean;
  /**
   * The save to send, when the parent of this revision is not yet stored.
   * A chain inside one changeset builds each save from the document that the
   * revision before it made, because the server cannot answer for a revision
   * that the same submission carries.
   */
  readonly save?: {
    readonly update: string | null;
    readonly epoch: number;
    readonly observed: string;
  };
}): Promise<{
  revisionId: string;
  fileId: string;
  parents: string[];
  path: string;
  deleted: boolean;
  content: {
    kind: 'markdown';
    document: {
      update: string | null;
      epoch: number;
      observed: string;
    };
  };
  clientTime: string;
  message: null;
  restoredFrom: null;
}> {
  const text = seed.text ?? `# ${seed.path}\n`;
  // A save carries the work of this device, not its text (record 0081). A
  // deletion carries no work at all and states only what it had seen.
  const head = seed.parents?.[0];
  const save =
    seed.save ??
    (head === undefined
      ? firstSave(text)
      : await saveForHead(workspaceId, head, text));
  return {
    revisionId: randomUUID(),
    fileId: seed.fileId,
    parents: [...(seed.parents ?? [])],
    path: seed.path,
    deleted: seed.deleted ?? false,
    content: {
      kind: 'markdown',
      document: seed.deleted === true ? { ...save, update: null } : save,
    },
    clientTime: '2026-09-06T10:00:00.000Z',
    message: null,
    restoredFrom: null,
  };
}

await test('a created file is readable with a strong entity tag', async () => {
  const file = await newFile('notes/first.md', '# first\n');
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(read.error, undefined);
  const response = responseOf(read.response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), `"${file.revisionId}"`);
  assert.equal(read.data?.path, 'notes/first.md');
  assert.equal(read.data?.head?.text, '# first\n');
  assert.equal(read.data?.headRevisionId, file.revisionId);
  // The answer carries public metadata only. No storage internal appears.
  const raw = JSON.stringify(read.data);
  assert.equal(raw.includes('workspace_id'), false);
  assert.equal(raw.includes('changesetId'), false);
});

await test('a read names the parts of the head that it carries', async () => {
  // Issue 264. Every read carried the text and the whole document, so a
  // reader that shows the text received more than twice its text.
  const file = await newFile('notes/parts.md', '# parts\nOne line.\n');
  const plain = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  const text = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
    query: { content: 'text' },
  });
  const full = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
    query: { content: 'full' },
  });
  // A caller that names no value reads what it read before: the text and
  // the document.
  assert.equal(plain.data?.head?.text, '# parts\nOne line.\n');
  assert.equal(typeof plain.data?.head?.document, 'string');
  assert.deepEqual(full.data, plain.data);
  // The text alone carries no document, and the same head and tag.
  assert.equal(text.data?.head?.text, '# parts\nOne line.\n');
  assert.equal(text.data?.head?.document, null);
  assert.equal(text.data?.head?.revisionId, file.revisionId);
  assert.equal(
    responseOf(text.response).headers.get('etag'),
    `"${file.revisionId}"`,
  );
  assert.ok(
    Number(responseOf(text.response).headers.get('content-length')) <
      Number(responseOf(plain.response).headers.get('content-length')),
  );
  // Any other value is outside the contract.
  const refused = await server.app.inject({
    method: 'GET',
    url: `/api/workspaces/${workspaceId}/files/${file.fileId}?content=document`,
    headers: { cookie, origin: 'http://127.0.0.1' },
  });
  assert.equal(refused.statusCode, 400);
  assert.equal(
    readProperty(JSON.parse(refused.body), 'code'),
    'invalid_request',
  );
});

await test('a large read leaves compressed and keeps the tag of its revision', async () => {
  // Issue 264, record 0169. No JSON answer was compressed, so a read sent
  // every byte of its text and of its document.
  const text = `# large\n${'One line of a long note.\n'.repeat(2000)}`;
  const file = await newFile('notes/large.md', text);
  const encoded = await getFile({
    headers: { ...browser(cookie), 'accept-encoding': 'br, gzip' },
    path: { workspaceId, fileId: file.fileId },
  });
  const plain = await getFile({
    headers: { ...browser(cookie), 'accept-encoding': 'identity' },
    path: { workspaceId, fileId: file.fileId },
  });
  const sent = responseOf(encoded.response);
  const whole = responseOf(plain.response);
  assert.equal(sent.headers.get('content-encoding'), 'br');
  assert.equal(whole.headers.get('content-encoding'), null);
  for (const response of [sent, whole]) {
    assert.match(response.headers.get('vary') ?? '', /accept-encoding/i);
    assert.equal(response.headers.get('etag'), `"${file.revisionId}"`);
  }
  assert.ok(
    Number(sent.headers.get('content-length')) * 4 <
      Number(whole.headers.get('content-length')),
    'the compressed read is a fraction of the plain read',
  );
  // The client reads the same answer from both.
  assert.equal(encoded.data?.head?.text, text);
  assert.deepEqual(encoded.data, plain.data);
  // A conditional read of the same revision still answers 304.
  const cached = await getFile({
    headers: {
      ...browser(cookie),
      'accept-encoding': 'br, gzip',
      'if-none-match': sent.headers.get('etag') ?? '',
    },
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(responseOf(cached.response).status, 304);
});

await test('a deeply nested note path stays durable', async () => {
  const path = 'work/plans/next/outline.md';
  const file = await newFile(path, '# Nested note\n');
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(read.error, undefined);
  assert.equal(read.data?.path, path);
  assert.equal(read.data?.head?.text, '# Nested note\n');

  const listed = await listFiles({
    headers: browser(cookie),
    path: { workspaceId },
    query: { limit: 500, sort: 'path' },
  });
  assert.equal(listed.error, undefined);
  assert.ok(listed.data?.files.some((entry) => entry.path === path));
});

await test('a conditional read of an unchanged file answers 304', async () => {
  const file = await newFile('notes/cached.md');
  const cached = await getFile({
    headers: { ...browser(cookie), 'if-none-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
  });
  const response = responseOf(cached.response);
  assert.equal(response.status, 304);
  assert.equal(response.headers.get('etag'), file.tag);
  assert.equal(await response.text(), '');
  // A tag of another state still returns the content.
  const fresh = await getFile({
    headers: {
      ...browser(cookie),
      'if-none-match': `"${randomUUID()}"`,
    },
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(responseOf(fresh.response).status, 200);
});

await test('an update needs the entity tag of the head it saw', async () => {
  const file = await newFile('notes/edited.md', '# one\n');
  const missing = await updateFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(workspaceId, file.revisionId, '# two\n'),
      ...ids(),
    },
  });
  assert.equal(responseOf(missing.response).status, 428);
  assert.equal(problemCode(missing.error), 'precondition_required');

  const stale = await updateFile({
    headers: { ...browser(cookie), 'if-match': `"${randomUUID()}"` },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(workspaceId, file.revisionId, '# two\n'),
      ...ids(),
    },
  });
  assert.equal(responseOf(stale.response).status, 412);
  assert.equal(problemCode(stale.error), 'stale_head');
  assert.deepEqual(problemFiles(stale.error), [file.fileId]);

  // An entity tag that this server never issued names no head either, and it
  // must not reach storage as an identifier.
  const malformed = await updateFile({
    headers: { ...browser(cookie), 'if-match': '"not-a-revision-tag"' },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(workspaceId, file.revisionId, '# two\n'),
      ...ids(),
    },
  });
  assert.equal(responseOf(malformed.response).status, 412);
  assert.equal(problemCode(malformed.error), 'stale_head');

  const updated = await updateFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(workspaceId, file.revisionId, '# two\n'),
      ...ids(),
    },
  });
  assert.equal(updated.error, undefined, JSON.stringify(updated.error));
  const response = responseOf(updated.response);
  assert.equal(response.status, 200);
  const revisionId = updated.data?.revision.revisionId ?? '';
  assert.equal(response.headers.get('etag'), `"${revisionId}"`);
  assert.deepEqual(updated.data?.revision.parents, [file.revisionId]);
  // The answer to a write carries the accepted record and no note text: the
  // client already holds the content it sent.
  assert.equal(
    JSON.stringify(updated.data?.revision).includes('two'),
    false,
    JSON.stringify(updated.data?.revision),
  );
  assert.equal(updated.data?.revision.actorAccountId, ownerAccountId);
  assert.match(updated.data?.revision.serverTime ?? '', /^\d{4}-/);

  // The old tag is stale now, and the same write with it answers 412.
  const again = await updateFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(workspaceId, file.revisionId, '# three\n'),
      ...ids(),
    },
  });
  assert.equal(responseOf(again.response).status, 412);
});

await test('a rename keeps the content and the file identity', async () => {
  const file = await newFile('notes/before.md', '# keep\n');
  const renamed = await updateFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: { path: 'archive/after.md', ...ids() },
  });
  assert.equal(renamed.error, undefined, JSON.stringify(renamed.error));
  assert.equal(renamed.data?.revision.path, 'archive/after.md');
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(read.data?.path, 'archive/after.md');
  // The text was not resent, so the revision reuses the stored content.
  assert.equal(read.data?.head?.text, '# keep\n');
});

await test('a deletion writes a tombstone and hides the file', async () => {
  const file = await newFile('notes/removed.md');
  const removed = await deleteFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: {
      ...ids(),
      document: await deletionForHead(workspaceId, file.tag.replace(/"/g, '')),
    },
  });
  assert.equal(removed.error, undefined, JSON.stringify(removed.error));
  assert.equal(responseOf(removed.response).status, 200);
  assert.equal(removed.data?.revision.deleted, true);
  // A tombstone carries no content, so it adds no stored bytes.
  assert.equal(removed.data?.revision.size, 0);

  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(responseOf(read.response).status, 404);

  // The history of the deleted file stays readable.
  const tombstone = await getRevision({
    headers: browser(cookie),
    path: {
      workspaceId,
      revisionId: removed.data?.revision.revisionId ?? '',
    },
  });
  assert.equal(tombstone.error, undefined);
  assert.equal(tombstone.data?.deleted, true);
  assert.deepEqual(tombstone.data?.parents, [file.revisionId]);

  const files = await listFiles({
    headers: browser(cookie),
    path: { workspaceId },
    query: { limit: 500 },
  });
  assert.equal(files.error, undefined);
  assert.equal(
    (files.data?.files ?? []).some((entry) => entry.fileId === file.fileId),
    false,
  );
});

await test('a deletion clears the search row of a file', async () => {
  const file = await newFile('notes/published.md');
  const session = await openSession(database.migrationUrl);
  try {
    const before = await session.query(
      'select file_id from search_index where workspace_id = $1 and file_id = $2',
      [workspaceId, file.fileId],
    );
    assert.equal(before.length, 1);
  } finally {
    await session.close();
  }

  const removed = await deleteFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: {
      ...ids(),
      document: await deletionForHead(workspaceId, file.tag.replace(/"/g, '')),
    },
  });
  assert.equal(removed.error, undefined, JSON.stringify(removed.error));

  const after = await openSession(database.migrationUrl);
  try {
    const rows = await after.query(
      'select file_id from search_index where workspace_id = $1 and file_id = $2',
      [workspaceId, file.fileId],
    );
    assert.equal(rows.length, 0);
  } finally {
    await after.close();
  }
});

await test('a listing pages through the live files by cursor', async () => {
  const whole = await listFiles({
    headers: browser(cookie),
    path: { workspaceId },
    query: { limit: 500 },
  });
  assert.equal(whole.error, undefined);
  const expected = (whole.data?.files ?? []).map((file) => file.fileId);
  assert.ok(expected.length > 1);

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < expected.length + 1; page += 1) {
    const answer: Awaited<ReturnType<typeof listFiles>> = await listFiles({
      headers: browser(cookie),
      path: { workspaceId },
      query: cursor === null ? { limit: 1 } : { limit: 1, cursor },
    });
    assert.equal(answer.error, undefined);
    seen.push(...(answer.data?.files ?? []).map((file) => file.fileId));
    cursor = answer.data?.nextCursor ?? null;
    if (cursor === null) break;
    assert.match(cursor, /^updated\.[0-9a-f-]{36}\./);
  }
  assert.deepEqual(seen, expected);
});

await test('a listing sorts by path and refuses a cursor of the other sort', async () => {
  const byPath = await listFiles({
    headers: browser(cookie),
    path: { workspaceId },
    query: { limit: 500, sort: 'path' },
  });
  assert.equal(byPath.error, undefined);
  const paths = (byPath.data?.files ?? []).map((file) => file.path);
  assert.deepEqual(
    paths,
    [...paths].sort((left, right) => left.localeCompare(right)),
  );

  const firstPage = await listFiles({
    headers: browser(cookie),
    path: { workspaceId },
    query: { limit: 1, sort: 'path' },
  });
  const cursor = firstPage.data?.nextCursor ?? '';
  assert.match(cursor, /^path\.[0-9a-f-]{36}\./);
  // The cursor belongs to the sort that produced it, so the default order
  // refuses it instead of answering with the wrong rows.
  const mismatched = await listFiles({
    headers: browser(cookie),
    path: { workspaceId },
    query: { limit: 1, cursor },
  });
  assert.equal(responseOf(mismatched.response).status, 400);
  assert.equal(problemCode(mismatched.error), 'invalid_request');
});

await test('a replay after the head moved returns the first outcome', async () => {
  const file = await newFile('notes/replayed.md', '# one\n');
  const write = {
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(workspaceId, file.revisionId, '# two\n'),
      ...ids(),
    },
  };
  const first = await updateFile(write);
  assert.equal(first.error, undefined);
  const firstTag = responseOf(first.response).headers.get('etag');

  // Another change advances the head before the retry arrives.
  const between = await updateFile({
    headers: {
      ...browser(cookie),
      'if-match': `"${first.data?.revision.revisionId ?? ''}"`,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(
        workspaceId,
        first.data?.revision.revisionId ?? '',
        '# three\n',
      ),
      ...ids(),
    },
  });
  assert.equal(between.error, undefined);

  const replay = await updateFile(write);
  assert.equal(replay.error, undefined, JSON.stringify(replay.error));
  assert.deepEqual(replay.data?.accepted, first.data?.accepted);
  assert.deepEqual(replay.data?.revision, first.data?.revision);
  assert.equal(responseOf(replay.response).headers.get('etag'), firstTag);

  // The replay wrote nothing: the head is still the newer revision.
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(read.data?.head?.text, '# three\n');
});

await test('a stored outcome of an unknown shape stops the replay', async () => {
  // A replay answers from the stored outcome without repeating the write, so
  // the outcome must carry every member of an accepted changeset. A value
  // that does not is a defect of a writer. The read refuses loudly, because
  // an unchecked outcome would reach the client as the answer of a save that
  // it cannot compare with its own state.
  const file = await newFile('notes/broken-receipt.md', '# one\n');
  const identifiers = ids();

  // A stored receipt is immutable, so an outcome of an unknown shape can only
  // come from a writer of another release. The insert below states that row
  // directly, because no path of this release can write one.
  const session = await openSession(database.migrationUrl);
  try {
    await session.query(
      `insert into mutation_receipts
         (workspace_id, actor_account_id, mutation_id, request_digest, outcome)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        workspaceId,
        ownerAccountId,
        identifiers.mutationId,
        'sha256:an-earlier-release',
        '{"mutationId":"broken"}',
      ],
    );
  } finally {
    await session.close();
  }

  // The write reads the receipt of its mutation before it does anything else,
  // so the refusal reaches the person as the one server message.
  const broken = await updateFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(workspaceId, file.revisionId, '# two\n'),
      ...identifiers,
    },
  });
  assert.equal(responseOf(broken.response).status, 500);
  assert.equal(problemCode(broken.error), 'internal_error');

  // The note kept its first text: the refused read wrote nothing.
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(read.data?.head?.text, '# one\n');
});

await test('the same mutation identity with another body is refused', async () => {
  const file = await newFile('notes/reused.md', '# one\n');
  const identifiers = ids();
  const first = await updateFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(workspaceId, file.revisionId, '# two\n'),
      ...identifiers,
    },
  });
  assert.equal(first.error, undefined);
  const reused = await updateFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(
        workspaceId,
        file.revisionId,
        '# another text\n',
      ),
      ...identifiers,
    },
  });
  assert.equal(responseOf(reused.response).status, 409);
  assert.equal(problemCode(reused.error), 'mutation_reused');
});

await test('two files swap their paths in one changeset', async () => {
  const left = await newFile('swap/left.md');
  const right = await newFile('swap/right.md');
  const swapped = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: {
        [left.fileId]: left.revisionId,
        [right.fileId]: right.revisionId,
      },
      revisions: [
        await revisionBody({
          fileId: left.fileId,
          path: 'swap/right.md',
          parents: [left.revisionId],
        }),
        await revisionBody({
          fileId: right.fileId,
          path: 'swap/left.md',
          parents: [right.revisionId],
        }),
      ],
    },
  });
  assert.equal(swapped.error, undefined, JSON.stringify(swapped.error));
  assert.equal(swapped.data?.revisionIds.length, 2);
  const readLeft = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: left.fileId },
  });
  assert.equal(readLeft.data?.path, 'swap/right.md');
});

await test('a stale delete after newer edits is refused and the edits survive', async () => {
  const file = await newFile('rebase/kept.md', '# first\n');
  // Another device saves newer text that this delete never saw.
  const newer = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: { [file.fileId]: file.revisionId },
      revisions: [
        await revisionBody({
          fileId: file.fileId,
          path: 'rebase/kept.md',
          text: '# text that must survive\n',
          parents: [file.revisionId],
        }),
      ],
    },
  });
  assert.equal(newer.error, undefined, JSON.stringify(newer.error));
  const newHead = newer.data?.revisionIds[0] ?? '';

  const staleDelete = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: { [file.fileId]: file.revisionId },
      revisions: [
        await revisionBody({
          fileId: file.fileId,
          path: 'rebase/kept.md',
          text: '',
          deleted: true,
          parents: [file.revisionId],
        }),
      ],
    },
  });
  // The deletion states the state of the first revision, so it never saw the
  // newer text. The workspace refuses it rather than hiding that text
  // (record 0083).
  assert.equal(responseOf(staleDelete.response).status, 409);
  assert.equal(problemCode(staleDelete.error), 'unseen_work');
  assert.deepEqual(problemFiles(staleDelete.error), [file.fileId]);

  // The note is still in the tree, and its head is the newer text.
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(read.error, undefined);
  assert.equal(read.data?.headRevisionId, newHead);
  const kept = await getRevision({
    headers: browser(cookie),
    path: { workspaceId, revisionId: newHead },
  });
  assert.equal(kept.data?.text, '# text that must survive\n');
});

await test('a stale save answer names the head that the rebase passed', async () => {
  const file = await newFile('rebase/reported.md', '# first\n');
  const elsewhere = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: { [file.fileId]: file.revisionId },
      revisions: [
        await revisionBody({
          fileId: file.fileId,
          path: 'rebase/renamed.md',
          text: '# from another device\n',
          parents: [file.revisionId],
        }),
      ],
    },
  });
  assert.equal(elsewhere.error, undefined, JSON.stringify(elsewhere.error));
  const passedHead = elsewhere.data?.revisionIds[0] ?? '';

  const stale = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: { [file.fileId]: file.revisionId },
      revisions: [
        await revisionBody({
          fileId: file.fileId,
          path: 'rebase/reported.md',
          text: '# saved later\n',
          parents: [file.revisionId],
        }),
      ],
    },
  });
  assert.equal(stale.error, undefined, JSON.stringify(stale.error));
  const acceptedId = stale.data?.revisionIds[0] ?? '';
  assert.deepEqual(stale.data?.superseded, [
    {
      fileId: file.fileId,
      previousHeadRevisionId: passedHead,
      acceptedRevisionId: acceptedId,
    },
  ]);
  // The later save wins its text, and it keeps the name that the rename set.
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(read.data?.path, 'rebase/renamed.md');
  assert.equal(read.data?.headRevisionId, acceptedId);
});

await test('a save on the current head reports no superseded head', async () => {
  const file = await newFile('rebase/linear.md', '# first\n');
  const next = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: { [file.fileId]: file.revisionId },
      revisions: [
        await revisionBody({
          fileId: file.fileId,
          path: 'rebase/linear.md',
          text: '# second\n',
          parents: [file.revisionId],
        }),
      ],
    },
  });
  assert.equal(next.error, undefined, JSON.stringify(next.error));
  assert.deepEqual(next.data?.superseded, []);
});

await test('text typed before a delete brings the note back', async () => {
  const file = await newFile('rebase/gone.md', '# first\n');
  const removed = await deleteFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: {
      ...ids(),
      document: await deletionForHead(workspaceId, file.tag.replace(/"/g, '')),
    },
  });
  assert.equal(removed.error, undefined, JSON.stringify(removed.error));

  const stale = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: { [file.fileId]: file.revisionId },
      revisions: [
        await revisionBody({
          fileId: file.fileId,
          path: 'rebase/gone.md',
          text: '# typed before the delete\n',
          parents: [file.revisionId],
        }),
      ],
    },
  });
  // The edit is the later write and the tombstone kept the document behind
  // it, so the work applies and the note returns (record 0083).
  assert.equal(stale.error, undefined, JSON.stringify(stale.error));
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(responseOf(read.response).status, 200);
  assert.equal(read.data?.head?.deleted, false);
  assert.ok(
    (read.data?.head?.text ?? '').includes('# typed before the delete'),
    read.data?.head?.text ?? '',
  );
});

await test('one conflicting file rolls back the whole changeset', async () => {
  const moved = await newFile('batch/moved.md');
  const other = await newFile('batch/other.md');
  const blocker = await newFile('batch/taken.md');
  const before = await listFiles({
    headers: browser(cookie),
    path: { workspaceId },
    query: { limit: 1 },
  });
  assert.equal(before.error, undefined);

  const refused = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: {
        [moved.fileId]: moved.revisionId,
        [other.fileId]: other.revisionId,
      },
      revisions: [
        // The first file asks for a path that a file outside the changeset
        // holds, so nothing in the changeset may commit.
        await revisionBody({
          fileId: moved.fileId,
          path: 'batch/taken.md',
          parents: [moved.revisionId],
        }),
        await revisionBody({
          fileId: other.fileId,
          path: 'batch/renamed.md',
          parents: [other.revisionId],
        }),
      ],
    },
  });
  assert.equal(responseOf(refused.response).status, 409);
  assert.equal(problemCode(refused.error), 'path_conflict');

  // No part of the changeset was written.
  for (const [file, path] of [
    [moved, 'batch/moved.md'],
    [other, 'batch/other.md'],
    [blocker, 'batch/taken.md'],
  ] as const) {
    const read = await getFile({
      headers: browser(cookie),
      path: { workspaceId, fileId: file.fileId },
    });
    assert.equal(read.data?.path, path);
    assert.equal(read.data?.headRevisionId, file.revisionId);
  }

  // The refused changeset consumed no cursor either, so the next accepted
  // change follows the one before it without a gap.
  const session = await openSession(database.migrationUrl);
  try {
    const rows = await session.query<{ last_cursor: string }>(
      'select last_cursor from workspace_cursors where workspace_id = $1',
      [workspaceId],
    );
    const before = BigInt(rows[0]?.last_cursor ?? '0');
    const accepted = await updateFile({
      headers: { ...browser(cookie), 'if-match': `"${other.revisionId}"` },
      path: { workspaceId, fileId: other.fileId },
      body: {
        document: await saveForHead(
          workspaceId,
          other.revisionId,
          '# after the conflict\n',
        ),
        ...ids(),
      },
    });
    assert.equal(accepted.error, undefined);
    assert.equal(BigInt(accepted.data?.accepted.cursor ?? '0'), before + 1n);
  } finally {
    await session.close();
  }
});

await test('the workspace derives the digest of the text it accepted', async () => {
  // A save carries work, not text (record 0081), so a device cannot name the
  // digest of other bytes. The workspace derives the text from the accepted
  // document and addresses it by the digest of that text.
  const fileId = randomUUID();
  const committed = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: { [fileId]: null },
      revisions: [
        await revisionBody({
          fileId,
          path: 'notes/derived.md',
          text: '# the text that was sent\n',
        }),
      ],
    },
  });
  assert.equal(committed.error, undefined, JSON.stringify(committed.error));
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId },
  });
  assert.equal(read.data?.head?.text, '# the text that was sent\n');
  assert.equal(
    read.data?.head?.digest,
    await contentDigest('# the text that was sent\n'),
  );
});

await test('a path outside the rules is refused', async () => {
  const fileId = randomUUID();
  const refused = await createFile({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      fileId,
      path: 'notes/../escape.md',
      document: firstSave('# x\n'),
      ...ids(),
    },
  });
  assert.equal(responseOf(refused.response).status, 422);
  assert.equal(problemCode(refused.error), 'invalid_path');
});

await test('a body member that the contract does not declare is refused', async () => {
  const response = await server.app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspaceId}/files`,
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: 'http://127.0.0.1',
    },
    payload: JSON.stringify({
      fileId: randomUUID(),
      path: 'notes/forged-actor.md',
      text: '# x\n',
      revisionId: randomUUID(),
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      // A client cannot name the actor or the acceptance time: the workspace
      // assigns both.
      actorAccountId: randomUUID(),
      serverTime: '2020-01-01T00:00:00.000Z',
    }),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(
    readProperty(JSON.parse(response.body), 'code'),
    'invalid_request',
  );
});

await test('a write operation refuses a wrong request media type', async () => {
  const response = await server.app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspaceId}/files`,
    headers: {
      'content-type': 'text/plain',
      cookie,
      origin: 'http://127.0.0.1',
    },
    payload: 'path=notes/plain.md',
  });
  assert.equal(response.statusCode, 415);
  assert.equal(
    readProperty(JSON.parse(response.body), 'code'),
    'unsupported_media_type',
  );
});

await test('a folder change of 1000 files commits, and 1001 does not', async () => {
  const fileIds = Array.from({ length: 1001 }, () => randomUUID());
  const created = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: Object.fromEntries(
        fileIds.slice(0, 1000).map((fileId) => [fileId, null]),
      ),
      revisions: await Promise.all(
        fileIds
          .slice(0, 1000)
          .map((fileId, index) =>
            revisionBody({ fileId, path: `folder/${String(index)}.md` }),
          ),
      ),
    },
  });
  assert.equal(created.error, undefined, JSON.stringify(created.error));
  assert.equal(created.data?.revisionIds.length, 1000);

  const heads = new Map(
    fileIds.slice(0, 1000).map((fileId, index) => {
      const revisionId = created.data?.revisionIds[index] ?? '';
      return [fileId, revisionId];
    }),
  );
  const renamed = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: Object.fromEntries(heads),
      revisions: await Promise.all(
        [...heads.entries()].map(([fileId, head], index) =>
          revisionBody({
            fileId,
            path: `renamed/${String(index)}.md`,
            parents: [head],
            text: `# folder/${String(index)}.md\n`,
          }),
        ),
      ),
    },
  });
  assert.equal(renamed.error, undefined, JSON.stringify(renamed.error));
  assert.equal(renamed.data?.revisionIds.length, 1000);

  const overLimit = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: Object.fromEntries(
        fileIds.map((fileId) => [fileId, null]),
      ),
      revisions: await Promise.all(
        fileIds.map((fileId, index) =>
          revisionBody({ fileId, path: `over/${String(index)}.md` }),
        ),
      ),
    },
  });
  assert.equal(responseOf(overLimit.response).status, 422);
  // The revisions are a valid change of the stored history, and the only
  // problem is how many of them there are, so the refusal states that. A
  // person renaming a folder then reads the number of notes as the cause and
  // not the history of one note.
  assert.equal(problemCode(overLimit.error), 'too_many_files');
  assert.equal(problemFiles(overLimit.error).length, 1001);
});

await test('a conditional read accepts a tag list and the star form', async () => {
  const file = await newFile('notes/conditional.md');
  const listed = await getFile({
    headers: {
      ...browser(cookie),
      'if-none-match': `"${randomUUID()}", ${file.tag}`,
    },
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(responseOf(listed.response).status, 304);
  // The star form means any representation, so an existing file is unchanged.
  const star = await getFile({
    headers: { ...browser(cookie), 'if-none-match': '*' },
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(responseOf(star.response).status, 304);
});

await test('a write refuses the star precondition and accepts a tag list', async () => {
  const file = await newFile('notes/precondition.md');
  // A star would accept whatever the head is now, which is the lost update
  // that this precondition exists to prevent.
  const star = await updateFile({
    headers: { ...browser(cookie), 'if-match': '*' },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(workspaceId, file.revisionId, '# two\n'),
      ...ids(),
    },
  });
  assert.equal(responseOf(star.response).status, 428);
  assert.equal(problemCode(star.error), 'precondition_required');

  const list = await updateFile({
    headers: {
      ...browser(cookie),
      'if-match': `"${randomUUID()}", ${file.tag}`,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      document: await saveForHead(workspaceId, file.revisionId, '# two\n'),
      ...ids(),
    },
  });
  assert.equal(list.error, undefined, JSON.stringify(list.error));
  assert.equal(responseOf(list.response).status, 200);
});

await test('a write to a file that does not exist answers 404', async () => {
  const missing = await updateFile({
    headers: { ...browser(cookie), 'if-match': `"${randomUUID()}"` },
    path: { workspaceId, fileId: randomUUID() },
    // The note does not exist, so the save states the work of a device that
    // starts one. The workspace answers before it reads any document.
    body: { document: firstSave('# x\n'), ...ids() },
  });
  assert.equal(responseOf(missing.response).status, 404);
  assert.equal(problemCode(missing.error), 'not_found');
});

await test('a file identifier that already exists cannot be created again', async () => {
  const file = await newFile('notes/taken-id.md');
  const again = await createFile({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      fileId: file.fileId,
      path: 'notes/other-name.md',
      document: firstSave('# x\n'),
      ...ids(),
    },
  });
  // The changeset states that the file must not exist, so the accepted head
  // fails that precondition.
  assert.equal(responseOf(again.response).status, 412);
  assert.equal(problemCode(again.error), 'stale_head');
  assert.deepEqual(problemFiles(again.error), [file.fileId]);
});

await test('one submission can carry a chain of revisions of one file', async () => {
  const fileId = randomUUID();
  // The second save follows the document that the first one made, because the
  // server holds neither revision while the submission is built.
  const one = saveOf(emptyDocument(), '# a\n');
  const two = saveOf(one.document, '# b\n');
  const first = await revisionBody({
    fileId,
    path: 'chain/one.md',
    text: '# a\n',
    save: one.save,
  });
  const second = await revisionBody({
    fileId,
    path: 'chain/one.md',
    text: '# b\n',
    parents: [first.revisionId],
    save: two.save,
  });
  const committed = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: { [fileId]: null },
      revisions: [first, second],
    },
  });
  assert.equal(committed.error, undefined, JSON.stringify(committed.error));
  assert.deepEqual(committed.data?.revisionIds, [
    first.revisionId,
    second.revisionId,
  ]);
  // The last revision of the chain becomes the head.
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId },
  });
  assert.equal(read.data?.headRevisionId, second.revisionId);
  assert.equal(read.data?.head?.text, '# b\n');
});

await test('a replayed changeset repeats its first outcome', async () => {
  const fileId = randomUUID();
  const body = {
    mutationId: randomUUID(),
    deviceId: 'integration-device',
    expectedHeads: { [fileId]: null },
    revisions: [await revisionBody({ fileId, path: 'replay/one.md' })],
  };
  const first = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body,
  });
  assert.equal(first.error, undefined, JSON.stringify(first.error));
  const replay = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body,
  });
  assert.equal(replay.error, undefined, JSON.stringify(replay.error));
  assert.deepEqual(replay.data, first.data);
});

await test('text that is not well formed never leaves the device', async () => {
  // A lone surrogate becomes U+FFFD in UTF-8, so the stored bytes would differ
  // from the text of the note. The document is the one door to the text
  // (record 0081), so the door refuses the text and no save is ever built.
  const broken = '# \ud800\n';
  const refused = replaceDocumentText(startDocument(''), broken);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.refusal, 'not-well-formed');

  // The workspace refuses the same text on its own, so a caller that reaches
  // the store without a device cannot store it either.
  const actor = memberActor(ownerAccountId, workspaceId);
  const fileId = randomUUID();
  const refusedByStore = await content.transact(actor, workspaceId, (tx) =>
    acceptWithDocuments(
      content.documents,
      tx,
      actor,
      changeset(
        workspaceId,
        [
          revision({
            fileId,
            path: 'notes/broken.md',
            content: markdown(broken),
          }),
        ],
        { expectedHeads: { [fileId]: null } },
      ),
      'broken-text-digest',
    ),
  );
  assert.equal(refusedByStore.ok, false);
  if (!refusedByStore.ok)
    assert.equal(refusedByStore.error.code, 'invalid_content');
});

await test('a purged file identifier answers 410', async () => {
  const fileId = randomUUID();
  const session = await openSession(database.migrationUrl);
  try {
    // Permanent deletion belongs to a later task, so the marker is written
    // with the migration role.
    await session.query(
      'insert into purge_markers (workspace_id, file_id) values ($1, $2)',
      [workspaceId, fileId],
    );
  } finally {
    await session.close();
  }
  const refused = await createFile({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      fileId,
      path: 'notes/purged.md',
      document: firstSave('# x\n'),
      ...ids(),
    },
  });
  assert.equal(responseOf(refused.response).status, 410);
  assert.equal(problemCode(refused.error), 'purged');
});

await test('a note that nests too deeply is refused with a message', async () => {
  // The link index reads the Markdown of every accepted head inside the same
  // transaction, so a note the Markdown package refuses used to leave the
  // boundary as a 500. It is a domain failure with a message for the author.
  const fileId = randomUUID();
  const refused = await createFile({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      fileId,
      path: 'notes/too-deep.md',
      document: firstSave(`${'> '.repeat(200)}deep\n`),
      ...ids(),
    },
  });
  assert.equal(responseOf(refused.response).status, 422);
  assert.equal(problemCode(refused.error), 'unrenderable_note');
  assert.equal(
    problemDetail(refused.error),
    'This note nests too deeply. Remove some levels of lists, quotes or HTML.',
  );
  assert.equal(readProperty(refused.error, 'noteRefusal'), 'note_too_deep');
  assert.deepEqual(problemFiles(refused.error), [fileId]);

  // The refused save changed nothing, so the path is still free.
  const accepted = await createFile({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      fileId: randomUUID(),
      path: 'notes/too-deep.md',
      document: firstSave('# shallow\n'),
      ...ids(),
    },
  });
  assert.equal(accepted.error, undefined, JSON.stringify(accepted.error));
});

await test('a note whose HTML nests too deeply is refused with a message', async () => {
  // Review of the audit of 2026-10-02. The renderer refused HTML deeper than
  // the limit and the search index of a commit read it: 500 levels saved a
  // note that no page could show, and 5000 levels left the boundary as a 500
  // with a RangeError. Both are now the typed refusal of every deep note.
  for (const levels of [500, 5000]) {
    const fileId = randomUUID();
    const refused = await createFile({
      headers: browser(cookie),
      path: { workspaceId },
      body: {
        fileId,
        path: `notes/deep-html-${String(levels)}.md`,
        document: firstSave(`${'<div>'.repeat(levels)}x\n`),
        ...ids(),
      },
    });
    assert.equal(responseOf(refused.response).status, 422, String(levels));
    assert.equal(problemCode(refused.error), 'unrenderable_note');
    assert.equal(
      problemDetail(refused.error),
      'This note nests too deeply. Remove some levels of lists, quotes or HTML.',
    );
    assert.deepEqual(problemFiles(refused.error), [fileId]);
  }
});

await test('a note of too many marks or table cells is refused with its own message', async () => {
  // Record 0182. The parse of a short note of nested images held a worker
  // for seconds, and a note of many table cells held it longer with each
  // cell. Each is now the typed refusal of its own limit, before the parse.
  // The device keeps the limit with a refused save, and its Needs attention
  // list reads the same sentence as this answer (record 0182).
  const cases = [
    [
      'notes/marks.md',
      `${'!['.repeat(3000)}x${'](u)'.repeat(3000)}\n`,
      'note_too_many_marks',
    ],
    [
      'notes/cells.md',
      `|a|b|\n|-|-|\n${'|c|d|\n'.repeat(3000)}`,
      'note_too_many_cells',
    ],
  ] as const;
  for (const [path, text, refusal] of cases) {
    const detail = noteRefusalSentence(refusal);
    const fileId = randomUUID();
    const refused = await createFile({
      headers: browser(cookie),
      path: { workspaceId },
      body: { fileId, path, document: firstSave(text), ...ids() },
    });
    assert.equal(responseOf(refused.response).status, 422, path);
    assert.equal(problemCode(refused.error), 'unrenderable_note');
    assert.equal(problemDetail(refused.error), detail);
    assert.equal(readProperty(refused.error, 'noteRefusal'), refusal);
    assert.deepEqual(problemFiles(refused.error), [fileId]);
  }
});

await test('a full workspace still accepts a deletion', async (t) => {
  // The control reserve is 1 MiB, so a limit just above it leaves room for one
  // small note and for the operations that manage a full workspace.
  const fullWorkspace = randomUUID();
  await seedWorkspace(database, fullWorkspace, [
    { accountId: ownerAccountId, role: 'owner' },
  ]);
  // The limit belongs to the owner account and counts every workspace it owns
  // (record 0112), so the owner gets this room above what it uses already,
  // and gets its limit back when the test ends.
  t.after(await limitAccountTo(database, ownerAccountId, (1n << 20n) + 2048n));
  const file = await newFile('notes/only.md', '# only\n', fullWorkspace);
  const refused = await createFile({
    headers: browser(cookie),
    path: { workspaceId: fullWorkspace },
    body: {
      fileId: randomUUID(),
      path: 'notes/second.md',
      document: firstSave('# second\n'),
      ...ids(),
    },
  });
  assert.equal(responseOf(refused.response).status, 413);
  assert.equal(problemCode(refused.error), 'quota_exceeded');

  // A full workspace still lets a person clear room.
  const removed = await deleteFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId: fullWorkspace, fileId: file.fileId },
    body: {
      ...ids(),
      document: await deletionForHead(
        fullWorkspace,
        file.tag.replace(/"/g, ''),
      ),
    },
  });
  assert.equal(removed.error, undefined, JSON.stringify(removed.error));
  assert.equal(removed.data?.revision.deleted, true);

  // A deletion carries no work at all (record 0081), so a caller that reaches
  // the store without the use case cannot spend the reserve through a
  // disguised write: the workspace drops the work of a tombstone.
  const actor = memberActor(ownerAccountId, fullWorkspace);
  const padding = `# ${'padding '.repeat(50_000)}\n`;
  const disguised = await content.transact(actor, fullWorkspace, (tx) =>
    acceptWithDocuments(
      content.documents,
      tx,
      actor,
      changeset(
        fullWorkspace,
        [
          revision({
            fileId: file.fileId,
            parents: [removed.data?.revision.revisionId ?? ''],
            path: 'notes/only.md',
            deleted: true,
            content: markdown(padding),
          }),
        ],
        {
          expectedHeads: {
            [file.fileId]: removed.data?.revision.revisionId ?? '',
          },
        },
      ),
      'disguised-delete-digest',
    ),
  );
  assert.equal(disguised.ok, true, JSON.stringify(disguised));
  const afterDisguise = await getRevision({
    headers: browser(cookie),
    path: {
      workspaceId: fullWorkspace,
      revisionId: disguised.ok ? (disguised.value.revisionIds[0] ?? '') : '',
    },
  });
  assert.equal(afterDisguise.data?.deleted, true);
  assert.equal(afterDisguise.data?.text, '');
});

await test('a workspace that the actor cannot see answers 404', async () => {
  const hidden = randomUUID();
  const refused = await listFiles({
    headers: browser(cookie),
    path: { workspaceId: hidden },
  });
  assert.equal(responseOf(refused.response).status, 404);
  assert.equal(problemCode(refused.error), 'not_found');
});

await server.close();
await auth.close();
await authPool.end();
await content.close();
await identity.close();
await database.destroy();
