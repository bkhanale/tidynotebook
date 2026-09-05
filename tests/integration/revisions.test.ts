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
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  commitChangeset,
  configureClient,
  createAgentToken,
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
import { contentDigest } from '@notesapp/core';
import {
  bootstrapOwner,
  createAuth,
  createAuthPool,
  createAuthProtocol,
  createHandlers,
  createIdentityAdapter,
  loadServerConfig,
  type ServerConfig,
} from '@notesapp/server';
import {
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import {
  createDisposableDatabase,
  openSession,
  seedWorkspace,
} from './support/database.ts';
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

/** The stable application error code of a failed generated call. */
function problemCode(error: unknown): string {
  const code = readProperty(error, 'code');
  return typeof code === 'string' ? code : '';
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
  return { origin: 'https://notes.test', cookie };
}

const database = await createDisposableDatabase();
const identity = openIdentityStore(database.runtimeUrl);
const content = openWorkspaceStore(database.runtimeUrl, { poolSize: 4 });

/** The environment of this test deployment. */
function environment(): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'https://notes.test',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: '/tmp',
    NOTESAPP_AUTH_SECRET: 'revision-test-secret-value-0123456789abcd',
    NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost,notes.test',
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
const auth = createAuth(config, { mail: null }, authPool);
const adapter = createIdentityAdapter({
  auth: auth.auth,
  identity,
  origin: config.origin,
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
  headers: { origin: 'https://notes.test' },
  body: { email: ownerEmail, password: ownerPassword },
});
const cookie = cookieHeader(
  responseOf(signedIn.response).headers.getSetCookie(),
);
assert.ok(cookie.length > 0, 'the test needs a session cookie');

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
    body: { fileId, path, text, ...ids() },
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
  readonly digest?: string;
}): Promise<{
  revisionId: string;
  fileId: string;
  parents: string[];
  path: string;
  deleted: boolean;
  content: { kind: 'markdown'; digest: string; text: string };
  clientTime: string;
  message: null;
  restoredFrom: null;
}> {
  const text = seed.text ?? `# ${seed.path}\n`;
  return {
    revisionId: randomUUID(),
    fileId: seed.fileId,
    parents: [...(seed.parents ?? [])],
    path: seed.path,
    deleted: seed.deleted ?? false,
    content: {
      kind: 'markdown',
      digest: seed.digest ?? (await contentDigest(text)),
      text,
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
    body: { text: '# two\n', ...ids() },
  });
  assert.equal(responseOf(missing.response).status, 428);
  assert.equal(problemCode(missing.error), 'precondition_required');

  const stale = await updateFile({
    headers: { ...browser(cookie), 'if-match': `"${randomUUID()}"` },
    path: { workspaceId, fileId: file.fileId },
    body: { text: '# two\n', ...ids() },
  });
  assert.equal(responseOf(stale.response).status, 412);
  assert.equal(problemCode(stale.error), 'stale_head');
  assert.deepEqual(problemFiles(stale.error), [file.fileId]);

  // An entity tag that this server never issued names no head either, and it
  // must not reach storage as an identifier.
  const malformed = await updateFile({
    headers: { ...browser(cookie), 'if-match': '"not-a-revision-tag"' },
    path: { workspaceId, fileId: file.fileId },
    body: { text: '# two\n', ...ids() },
  });
  assert.equal(responseOf(malformed.response).status, 412);
  assert.equal(problemCode(malformed.error), 'stale_head');

  const updated = await updateFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: { text: '# two\n', ...ids() },
  });
  assert.equal(updated.error, undefined, JSON.stringify(updated.error));
  const response = responseOf(updated.response);
  assert.equal(response.status, 200);
  const revisionId = updated.data?.revision.revisionId ?? '';
  assert.equal(response.headers.get('etag'), `"${revisionId}"`);
  assert.deepEqual(updated.data?.revision.parents, [file.revisionId]);
  assert.equal(updated.data?.revision.text, '# two\n');

  // The old tag is stale now, and the same write with it answers 412.
  const again = await updateFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: { text: '# three\n', ...ids() },
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
  // The text was not resent, so the revision reuses the stored content.
  assert.equal(renamed.data?.revision.text, '# keep\n');
  const read = await getFile({
    headers: browser(cookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(read.data?.path, 'archive/after.md');
});

await test('a deletion writes a tombstone and hides the file', async () => {
  const file = await newFile('notes/removed.md');
  const removed = await deleteFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: ids(),
  });
  assert.equal(removed.error, undefined, JSON.stringify(removed.error));
  assert.equal(responseOf(removed.response).status, 200);
  assert.equal(removed.data?.revision.deleted, true);
  assert.equal(removed.data?.revision.text, '');

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

await test('a deletion revokes the shares and clears the links of a file', async () => {
  const file = await newFile('notes/published.md');
  const session = await openSession(database.migrationUrl);
  try {
    // Sharing and the link index belong to later tasks, so their rows are
    // written with the migration role. The deletion has to reach both.
    await session.query(
      `insert into shares
        (workspace_id, id, file_id, pinned_revision_id, token_hash, creator_account_id)
        values ($1, $2, $3, $4, $5, $6)`,
      [
        workspaceId,
        randomUUID(),
        file.fileId,
        file.revisionId,
        `hash-${randomUUID()}`,
        ownerAccountId,
      ],
    );
    await session.query(
      `insert into link_index
        (workspace_id, source_file_id, source_revision_id, ordinal, target_file_id, source_text)
        values ($1, $2, $3, 0, null, 'a link')`,
      [workspaceId, file.fileId, file.revisionId],
    );
  } finally {
    await session.close();
  }

  const removed = await deleteFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: ids(),
  });
  assert.equal(removed.error, undefined, JSON.stringify(removed.error));

  const after = await openSession(database.migrationUrl);
  try {
    const shares = await after.query<{ revoked_at: Date | null }>(
      'select revoked_at from shares where workspace_id = $1 and file_id = $2',
      [workspaceId, file.fileId],
    );
    assert.equal(shares.length, 1);
    assert.notEqual(shares[0]?.revoked_at, null);
    const links = await after.query(
      'select ordinal from link_index where workspace_id = $1 and source_file_id = $2',
      [workspaceId, file.fileId],
    );
    assert.equal(links.length, 0);
  } finally {
    await after.close();
  }
});

await test('a listing pages through the live files by cursor', async () => {
  const first = await listFiles({
    headers: browser(cookie),
    path: { workspaceId },
    query: { limit: 1 },
  });
  assert.equal(first.error, undefined);
  assert.equal(first.data?.files.length, 1);
  const cursor = first.data?.nextCursor ?? '';
  assert.match(cursor, /^[0-9a-f-]{36}$/);
  const second = await listFiles({
    headers: browser(cookie),
    path: { workspaceId },
    query: { limit: 1, cursor },
  });
  assert.notEqual(second.data?.files[0]?.fileId, first.data?.files[0]?.fileId);
  assert.ok((second.data?.files[0]?.fileId ?? '') > cursor);
});

await test('a replay after the head moved returns the first outcome', async () => {
  const file = await newFile('notes/replayed.md', '# one\n');
  const write = {
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: { text: '# two\n', ...ids() },
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
    body: { text: '# three\n', ...ids() },
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

await test('the same mutation identity with another body is refused', async () => {
  const file = await newFile('notes/reused.md', '# one\n');
  const identifiers = ids();
  const first = await updateFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: { text: '# two\n', ...identifiers },
  });
  assert.equal(first.error, undefined);
  const reused = await updateFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId, fileId: file.fileId },
    body: { text: '# another text\n', ...identifiers },
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
      body: { text: '# after the conflict\n', ...ids() },
    });
    assert.equal(accepted.error, undefined);
    assert.equal(BigInt(accepted.data?.accepted.cursor ?? '0'), before + 1n);
  } finally {
    await session.close();
  }
});

await test('content that does not match its digest is refused', async () => {
  const fileId = randomUUID();
  const refused = await commitChangeset({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'integration-device',
      expectedHeads: { [fileId]: null },
      revisions: [
        await revisionBody({
          fileId,
          path: 'notes/forged.md',
          text: '# the text that was sent\n',
          digest: await contentDigest('# other bytes\n'),
        }),
      ],
    },
  });
  assert.equal(responseOf(refused.response).status, 422);
  assert.equal(problemCode(refused.error), 'invalid_content');
  assert.deepEqual(problemFiles(refused.error), [fileId]);
});

await test('a path outside the rules is refused', async () => {
  const fileId = randomUUID();
  const refused = await createFile({
    headers: browser(cookie),
    path: { workspaceId },
    body: { fileId, path: 'notes/../escape.md', text: '# x\n', ...ids() },
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
      origin: 'https://notes.test',
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
      origin: 'https://notes.test',
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
  assert.equal(problemCode(overLimit.error), 'invalid_graph');
  assert.equal(problemFiles(overLimit.error).length, 1001);
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
    body: { fileId, path: 'notes/purged.md', text: '# x\n', ...ids() },
  });
  assert.equal(responseOf(refused.response).status, 410);
  assert.equal(problemCode(refused.error), 'purged');
});

await test('a viewer may read but not write', async () => {
  const readOnlyWorkspace = randomUUID();
  await seedWorkspace(database, readOnlyWorkspace, [
    { accountId: ownerAccountId, role: 'viewer' },
  ]);
  const listedFiles = await listFiles({
    headers: browser(cookie),
    path: { workspaceId: readOnlyWorkspace },
  });
  assert.equal(listedFiles.error, undefined);
  assert.deepEqual(listedFiles.data?.files, []);

  const refused = await createFile({
    headers: browser(cookie),
    path: { workspaceId: readOnlyWorkspace },
    body: {
      fileId: randomUUID(),
      path: 'notes/denied.md',
      text: '# x\n',
      ...ids(),
    },
  });
  assert.equal(responseOf(refused.response).status, 403);
  assert.equal(problemCode(refused.error), 'forbidden');
});

await test('an agent token cannot write outside its scope', async () => {
  const issued = await createAgentToken({
    headers: browser(cookie),
    body: {
      name: 'reader',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: [{ workspaceId, actions: ['read'] }],
    },
  });
  assert.equal(issued.error, undefined, JSON.stringify(issued.error));
  const secret = issued.data?.secret ?? '';
  const allowed = await listFiles({
    headers: { authorization: `Bearer ${secret}` },
    path: { workspaceId },
    query: { limit: 1 },
  });
  assert.equal(allowed.error, undefined);
  const denied = await createFile({
    headers: { authorization: `Bearer ${secret}` },
    path: { workspaceId },
    body: {
      fileId: randomUUID(),
      path: 'notes/agent.md',
      text: '# x\n',
      ...ids(),
    },
  });
  assert.equal(responseOf(denied.response).status, 403);
  assert.equal(problemCode(denied.error), 'forbidden');
});

await test('a full workspace still accepts a deletion', async () => {
  // The control reserve is 1 MiB, so a quota just above it leaves room for one
  // small note and for the operations that manage a full workspace.
  const fullWorkspace = randomUUID();
  await seedWorkspace(
    database,
    fullWorkspace,
    [{ accountId: ownerAccountId, role: 'owner' }],
    (1n << 20n) + 2048n,
  );
  const file = await newFile('notes/only.md', '# only\n', fullWorkspace);
  const refused = await createFile({
    headers: browser(cookie),
    path: { workspaceId: fullWorkspace },
    body: {
      fileId: randomUUID(),
      path: 'notes/second.md',
      text: '# second\n',
      ...ids(),
    },
  });
  assert.equal(responseOf(refused.response).status, 413);
  assert.equal(problemCode(refused.error), 'quota_exceeded');

  const removed = await deleteFile({
    headers: { ...browser(cookie), 'if-match': file.tag },
    path: { workspaceId: fullWorkspace, fileId: file.fileId },
    body: ids(),
  });
  assert.equal(removed.error, undefined, JSON.stringify(removed.error));
  assert.equal(removed.data?.revision.deleted, true);
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
