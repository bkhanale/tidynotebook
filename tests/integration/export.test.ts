/**
 * Export of one note and of the whole workspace, against a real server.
 *
 * Every call goes through a generated operation. The archive is read back
 * with a small reader that walks the central directory, so the checks prove
 * that a real ZIP reader finds the notes at their paths and the referenced
 * image with its exact bytes.
 *
 * Start the database service first:
 *
 * ```sh
 * sudo -n docker compose -f compose.test.yaml up -d --wait
 * ```
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import {
  configureClient,
  createFile,
  createWorkspace,
  deleteFile,
  exportNote,
  exportWorkspace,
  finalizeAttachment,
  getAccount,
  importWorkspace,
  listWorkspaces,
  signInWithPassword,
  updateFile,
  uploadAttachment,
} from '@notesapp/api-client';
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
  openAttachmentStore,
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import sharp from 'sharp';
import { createDisposableDatabase, seedWorkspace } from './support/database.ts';
import { startTestServer } from './support/server.ts';

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

/** The headers of a browser request. A write also names the origin. */
function browser(cookie: string): Record<string, string> {
  return { origin: 'https://notes.test', cookie };
}

/** Every entry of a ZIP archive, read through its central directory. */
function readArchive(bytes: Buffer): ReadonlyMap<string, Buffer> {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(end, -1, 'the answer is not a zip archive');
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(at), 0x0201_4b50);
    const checksum = bytes.readUInt32LE(at + 16);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const offset = bytes.readUInt32LE(at + 42);
    const path = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    const start =
      offset +
      30 +
      bytes.readUInt16LE(offset + 26) +
      bytes.readUInt16LE(offset + 28);
    const content = bytes.subarray(start, start + size);
    assert.equal(crc32(content), checksum, `the checksum of ${path} is wrong`);
    entries.set(path, content);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-export-test-'));
const identity = openIdentityStore(database.runtimeUrl);
const content = openWorkspaceStore(database.runtimeUrl, { poolSize: 4 });
const attachments = openAttachmentStore(database.runtimeUrl, storageRoot, {
  poolSize: 4,
});

/** The environment of this test deployment. */
function environment(): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'https://notes.test',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'export-test-secret-value-0123456789abcdef',
    NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost,notes.test',
    NOTESAPP_LOG_LEVEL: 'silent',
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
    createHandlers(value, undefined, {
      store: identity,
      content,
      attachments,
    }),
  identity: adapter.resolver,
  protocols: [createAuthProtocol(config, auth.auth)],
});
configureClient(server.baseUrl, undefined);

const ownerEmail = 'export-owner@notes.invalid';
const ownerPassword = 'a-strong-export-password';
await bootstrapOwner({
  config,
  email: ownerEmail,
  name: 'ExportOwner',
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
assert.match(account.data?.accountId ?? '', /^[0-9a-f-]{36}$/);
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

/** Creates one note and returns its identifiers and its entity tag. */
async function newNote(
  path: string,
  text: string,
): Promise<{ fileId: string; tag: string }> {
  const fileId = randomUUID();
  const created = await createFile({
    headers: browser(cookie),
    path: { workspaceId },
    body: { fileId, path, text, ...ids() },
  });
  assert.equal(created.error, undefined, JSON.stringify(created.error));
  const tag = responseOf(created.response).headers.get('etag') ?? '';
  assert.notEqual(tag, '');
  return { fileId, tag };
}

const pngBytes = await sharp({
  create: {
    width: 24,
    height: 24,
    channels: 4,
    background: { r: 12, g: 240, b: 90, alpha: 1 },
  },
})
  .png()
  .toBuffer();

await test('one note is exported as a Markdown file with its name', async () => {
  const text = '# Quarter plan\n\nThe body of the note.\n';
  const note = await newNote('plans/quarter plan.md', text);
  const answer = await exportNote({
    headers: browser(cookie),
    path: { workspaceId, fileId: note.fileId },
  });
  assert.equal(answer.error, undefined, JSON.stringify(answer.error));
  const response = responseOf(answer.response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/markdown');
  assert.equal(
    response.headers.get('content-disposition'),
    `attachment; filename="quarter plan.md"; filename*=UTF-8''quarter%20plan.md`,
  );
  // The generated client parses a text media type into a string.
  assert.equal(answer.data, text);
});

await test('a deleted note cannot be exported', async () => {
  const note = await newNote('plans/gone.md', '# Gone\n');
  const removed = await deleteFile({
    headers: { ...browser(cookie), 'if-match': note.tag },
    path: { workspaceId, fileId: note.fileId },
    body: ids(),
  });
  assert.equal(removed.error, undefined, JSON.stringify(removed.error));
  const answer = await exportNote({
    headers: browser(cookie),
    path: { workspaceId, fileId: note.fileId },
  });
  assert.equal(responseOf(answer.response).status, 404);
});

await test('the archive holds every live note and the images they use', async () => {
  // One image, referenced by one note.
  const uploaded = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file: new File([pngBytes], 'shot.png', { type: 'image/png' }) },
  });
  assert.ok(uploaded.data);
  const attachmentRevisionId = randomUUID();
  const finalized = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId: uploaded.data.objectId },
    body: {
      fileId: randomUUID(),
      revisionId: attachmentRevisionId,
      path: 'attachments/shot.png',
      digest: uploaded.data.digest,
      mutationId: randomUUID(),
      deviceId: 'integration-device',
    },
  });
  assert.equal(responseOf(finalized.response).status, 200);

  const illustrated = '# With an image\n\n![shot](../attachments/shot.png)\n';
  await newNote('folder/illustrated.md', illustrated);
  const plain = '# Plain note\n\nNothing special.\n';
  await newNote('plain.md', plain);

  // One note that is deleted must not be in the archive.
  const doomed = await newNote('folder/doomed.md', '# Doomed\n');
  const removed = await deleteFile({
    headers: { ...browser(cookie), 'if-match': doomed.tag },
    path: { workspaceId, fileId: doomed.fileId },
    body: ids(),
  });
  assert.equal(removed.error, undefined, JSON.stringify(removed.error));

  const answer = await exportWorkspace({
    headers: browser(cookie),
    path: { workspaceId },
  });
  assert.equal(answer.error, undefined, JSON.stringify(answer.error));
  const response = responseOf(answer.response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.match(
    response.headers.get('content-disposition') ?? '',
    /^attachment; filename="notes\.zip"/,
  );

  const archive = Buffer.from(await (answer.data as Blob).arrayBuffer());
  const entries = readArchive(archive);
  const paths = [...entries.keys()];
  assert.ok(paths.includes('folder/illustrated.md'), paths.join(', '));
  assert.ok(paths.includes('plain.md'), paths.join(', '));
  assert.equal(
    entries.get('folder/illustrated.md')?.toString('utf8'),
    illustrated,
  );
  assert.equal(entries.get('plain.md')?.toString('utf8'), plain);
  // A deleted note holds no place in the file tree, so it is not exported.
  assert.equal(paths.includes('folder/doomed.md'), false);
  assert.equal(paths.includes('plans/gone.md'), false);
  // The referenced image travels with its exact bytes.
  const image = entries.get('attachments/shot.png');
  assert.ok(image !== undefined, paths.join(', '));
  assert.equal(Buffer.compare(image, pngBytes), 0);

  const createdWorkspace = await createWorkspace({
    headers: browser(cookie),
    body: { name: 'Imported workspace' },
  });
  const importedWorkspaceId = createdWorkspace.data?.workspaceId ?? '';
  assert.match(importedWorkspaceId, /^[0-9a-f-]{36}$/);
  const imported = await importWorkspace({
    headers: browser(cookie),
    path: { workspaceId: importedWorkspaceId },
    body: {
      file: new File([archive], 'notes.zip', { type: 'application/zip' }),
    },
  });
  assert.deepEqual(imported.data, {
    notes: paths.filter((path) => path.endsWith('.md')).length,
    attachments: 1,
  });
  const roundTrip = await exportWorkspace({
    headers: browser(cookie),
    path: { workspaceId: importedWorkspaceId },
  });
  const roundTripEntries = readArchive(
    Buffer.from(await (roundTrip.data as Blob).arrayBuffer()),
  );
  assert.deepEqual([...roundTripEntries.keys()], [...entries.keys()]);
  for (const [path, bytes] of entries)
    assert.equal(
      Buffer.compare(roundTripEntries.get(path) ?? Buffer.alloc(0), bytes),
      0,
    );
});

await test('the archive follows a rename and a later edit', async () => {
  const first = await newNote('moving.md', '# One\n');
  const changed = await updateFile({
    headers: { ...browser(cookie), 'if-match': first.tag },
    path: { workspaceId, fileId: first.fileId },
    body: { text: '# Two\n', path: 'moved/renamed.md', ...ids() },
  });
  assert.equal(changed.error, undefined, JSON.stringify(changed.error));
  const answer = await exportWorkspace({
    headers: browser(cookie),
    path: { workspaceId },
  });
  const entries = readArchive(
    Buffer.from(await (answer.data as Blob).arrayBuffer()),
  );
  assert.equal(entries.get('moved/renamed.md')?.toString('utf8'), '# Two\n');
  assert.equal(entries.has('moving.md'), false);
});

await test('a stranger cannot export a workspace', async () => {
  const otherWorkspace = randomUUID();
  await seedWorkspace(database, otherWorkspace, [
    { accountId: randomUUID(), role: 'owner' },
  ]);
  const answer = await exportWorkspace({
    headers: browser(cookie),
    path: { workspaceId: otherWorkspace },
  });
  assert.equal(responseOf(answer.response).status, 404);
});

// Teardown
await server.close();
await auth.close();
await authPool.end();
await attachments.close();
await content.close();
await identity.close();
await rm(storageRoot, { recursive: true, force: true });
await database.destroy();
