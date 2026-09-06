/**
 * Attachment transfer, inspection, and cleanup checks against a real server,
 * a real database, and real storage volumes.
 *
 * Every application call goes through a generated operation function.
 * Rules that only the database or background jobs can create are exercised
 * directly with the store.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  configureClient,
  finalizeAttachment,
  getAccount,
  getAttachmentRevision,
  listWorkspaces,
  signInWithPassword,
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
import { LogRecorder, startTestServer } from './support/server.ts';

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

/** SHA-256 digest of a binary buffer as a lowercase hex string. */
function sha256Hex(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** The client identifiers that every write carries. */
function mutationIds(): { mutationId: string; deviceId: string } {
  return {
    mutationId: randomUUID(),
    deviceId: 'integration-device',
  };
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-attachments-test-'));

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
    NOTESAPP_AUTH_SECRET: 'attachment-test-secret-value-0123456789abcd',
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
const logs = new LogRecorder();
const server = await startTestServer({
  environment: {
    ...environment(),
    NOTESAPP_LOG_LEVEL: 'info',
  },
  handlers: (value) =>
    createHandlers(value, undefined, {
      store: identity,
      content,
      attachments,
    }),
  identity: adapter.resolver,
  logStream: logs,
  protocols: [createAuthProtocol(config, auth.auth)],
});
configureClient(server.baseUrl, undefined);

const ownerEmail = 'attachment-owner@notes.invalid';
const ownerPassword = 'a-strong-attachment-password';
await bootstrapOwner({
  config,
  email: ownerEmail,
  name: 'AttachmentOwner',
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

// Sample test images
const samplePngBytes = await sharp({
  create: {
    width: 100,
    height: 100,
    channels: 4,
    background: { r: 255, g: 0, b: 0, alpha: 1 },
  },
})
  .png()
  .toBuffer();

const sampleJpegBytes = await sharp({
  create: {
    width: 100,
    height: 100,
    channels: 3,
    background: { r: 0, g: 255, b: 0 },
  },
})
  .jpeg()
  .toBuffer();

const sampleWebpBytes = await sharp({
  create: {
    width: 100,
    height: 100,
    channels: 4,
    background: { r: 0, g: 0, b: 255, alpha: 1 },
  },
})
  .webp()
  .toBuffer();

const sampleGifBytes = await sharp({
  create: {
    width: 100,
    height: 100,
    channels: 3,
    background: { r: 255, g: 255, b: 0 },
  },
})
  .gif()
  .toBuffer();

await test('upload and finalize PNG image with binary streaming download', async () => {
  const file = new File([samplePngBytes], 'diagram.png', {
    type: 'image/png',
  });
  const uploadResult = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file },
  });
  assert.equal(responseOf(uploadResult.response).status, 201);
  assert.ok(uploadResult.data);
  const { objectId, digest, size, mediaType, width, height } =
    uploadResult.data;
  assert.match(objectId, /^[0-9a-f-]{36}$/);
  assert.equal(digest, sha256Hex(samplePngBytes));
  assert.equal(size, samplePngBytes.length);
  assert.equal(mediaType, 'image/png');
  assert.equal(width, 100);
  assert.equal(height, 100);

  // Finalize as a new file revision
  const fileId = randomUUID();
  const revisionId = randomUUID();
  const mutationId = randomUUID();
  const finalizeResult = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId },
    body: {
      fileId,
      revisionId,
      path: 'assets/diagram.png',
      digest,
      mutationId,
      deviceId: 'integration-device',
      message: 'Add architecture diagram',
    },
  });
  assert.equal(responseOf(finalizeResult.response).status, 200);
  assert.ok(finalizeResult.data);
  assert.equal(finalizeResult.data.revision.revisionId, revisionId);
  assert.equal(
    finalizeResult.data.accepted.revisions[0]?.revisionId,
    revisionId,
  );

  // Read binary content via generated client
  const readResult = await getAttachmentRevision({
    headers: browser(cookie),
    path: { workspaceId, revisionId },
  });
  const res = responseOf(readResult.response);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(
    res.headers.get('content-length'),
    String(samplePngBytes.length),
  );
  assert.equal(res.headers.get('etag'), `"${revisionId}"`);

  assert.ok(readResult.data instanceof Blob);
  const downloadedBytes = Buffer.from(await readResult.data.arrayBuffer());
  assert.equal(sha256Hex(downloadedBytes), digest);
  assert.deepEqual(downloadedBytes, samplePngBytes);
});

await test('upload and finalize JPEG, WebP, and GIF images', async () => {
  const formats = [
    { bytes: sampleJpegBytes, mime: 'image/jpeg', name: 'photo.jpg' },
    { bytes: sampleWebpBytes, mime: 'image/webp', name: 'graphic.webp' },
    { bytes: sampleGifBytes, mime: 'image/gif', name: 'animation.gif' },
  ] as const;

  for (const item of formats) {
    const file = new File([item.bytes], item.name, { type: item.mime });
    const uploaded = await uploadAttachment({
      headers: browser(cookie),
      path: { workspaceId },
      body: { file },
    });
    assert.equal(responseOf(uploaded.response).status, 201);
    assert.ok(uploaded.data);
    assert.equal(uploaded.data.mediaType, item.mime);

    const fileId = randomUUID();
    const revisionId = randomUUID();
    const finalized = await finalizeAttachment({
      headers: browser(cookie),
      path: { workspaceId, objectId: uploaded.data.objectId },
      body: {
        fileId,
        revisionId,
        path: `assets/${item.name}`,
        digest: uploaded.data.digest,
        mutationId: randomUUID(),
        deviceId: 'integration-device',
      },
    });
    assert.equal(responseOf(finalized.response).status, 200);

    const read = await getAttachmentRevision({
      headers: browser(cookie),
      path: { workspaceId, revisionId },
    });
    const res = responseOf(read.response);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), item.mime);
    assert.ok(read.data instanceof Blob);
    const readBytes = Buffer.from(await read.data.arrayBuffer());
    assert.deepEqual(readBytes, item.bytes);
  }
});

await test('reject oversize pixel dimensions above 40 megapixels', async () => {
  // 7000 x 7000 = 49 megapixels, which exceeds the 40 megapixel limit
  const oversizePng = await sharp({
    create: {
      width: 7000,
      height: 7000,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const file = new File([oversizePng], 'huge.png', { type: 'image/png' });
  const uploadResult = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file },
  });
  assert.equal(responseOf(uploadResult.response).status, 413);
  assert.equal(problemCode(uploadResult.error), 'payload_too_large');
});

await test('reject oversize payload exceeding 20 MiB limit', async () => {
  // Allocate 21 MiB buffer
  const largeBuffer = Buffer.alloc(21 * 1024 * 1024);
  const file = new File([largeBuffer], 'large.png', { type: 'image/png' });
  const uploadResult = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file },
  });
  assert.equal(responseOf(uploadResult.response).status, 413);
  assert.equal(problemCode(uploadResult.error), 'payload_too_large');
});

await test('reject forged MIME type when content does not match', async () => {
  // Send JPEG bytes with declared image/png MIME type
  const file = new File([sampleJpegBytes], 'forged.png', {
    type: 'image/png',
  });
  const uploadResult = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file },
  });
  assert.equal(responseOf(uploadResult.response).status, 422);
  assert.equal(problemCode(uploadResult.error), 'invalid_content');
});

await test('reject malformed image bytes', async () => {
  const truncatedBytes = Buffer.from('89504e470d0a1a0a0000000d494844', 'hex');
  const file = new File([truncatedBytes], 'corrupt.png', {
    type: 'image/png',
  });
  const uploadResult = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file },
  });
  assert.equal(responseOf(uploadResult.response).status, 422);
  assert.equal(problemCode(uploadResult.error), 'invalid_content');
});

await test('reject SVG upload with unsupported media type', async () => {
  const svgText =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5"/></svg>';
  const file = new File([svgText], 'vector.svg', {
    type: 'image/svg+xml',
  });
  const uploadResult = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file },
  });
  assert.equal(responseOf(uploadResult.response).status, 415);
  assert.equal(problemCode(uploadResult.error), 'unsupported_media_type');
});

await test('enforce precondition rules on finalizeAttachment', async () => {
  const file = new File([samplePngBytes], 'icon.png', { type: 'image/png' });
  const firstUpload = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file },
  });
  assert.ok(firstUpload.data);

  const fileId = randomUUID();
  const revisionId1 = randomUUID();

  // Creating a new file with an unexpected If-Match header is refused
  const unexpectedPrecondition = await finalizeAttachment({
    headers: {
      ...browser(cookie),
      'if-match': '"00000000-0000-0000-0000-000000000000"',
    },
    path: { workspaceId, objectId: firstUpload.data.objectId },
    body: {
      fileId,
      revisionId: revisionId1,
      path: 'assets/icon.png',
      digest: firstUpload.data.digest,
      mutationId: randomUUID(),
      deviceId: 'integration-device',
    },
  });
  assert.equal(responseOf(unexpectedPrecondition.response).status, 412);
  assert.equal(problemCode(unexpectedPrecondition.error), 'stale_head');

  // Creating without If-Match succeeds
  const initial = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId: firstUpload.data.objectId },
    body: {
      fileId,
      revisionId: revisionId1,
      path: 'assets/icon.png',
      digest: firstUpload.data.digest,
      mutationId: randomUUID(),
      deviceId: 'integration-device',
    },
  });
  assert.equal(responseOf(initial.response).status, 200);

  // Upload second image to update the existing file
  const secondUpload = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      file: new File([sampleWebpBytes], 'icon.webp', { type: 'image/webp' }),
    },
  });
  assert.ok(secondUpload.data);

  const revisionId2 = randomUUID();

  // Updating existing file without If-Match answers 428
  const missingPrecondition = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId: secondUpload.data.objectId },
    body: {
      fileId,
      revisionId: revisionId2,
      path: 'assets/icon.png',
      digest: secondUpload.data.digest,
      mutationId: randomUUID(),
      deviceId: 'integration-device',
    },
  });
  assert.equal(responseOf(missingPrecondition.response).status, 428);
  assert.equal(problemCode(missingPrecondition.error), 'precondition_required');

  // Updating existing file with stale If-Match answers 412
  const stalePrecondition = await finalizeAttachment({
    headers: {
      ...browser(cookie),
      'if-match': '"00000000-0000-0000-0000-000000000000"',
    },
    path: { workspaceId, objectId: secondUpload.data.objectId },
    body: {
      fileId,
      revisionId: revisionId2,
      path: 'assets/icon.png',
      digest: secondUpload.data.digest,
      mutationId: randomUUID(),
      deviceId: 'integration-device',
    },
  });
  assert.equal(responseOf(stalePrecondition.response).status, 412);
  assert.equal(problemCode(stalePrecondition.error), 'stale_head');

  // Updating existing file with correct If-Match tag succeeds
  const updated = await finalizeAttachment({
    headers: {
      ...browser(cookie),
      'if-match': `"${revisionId1}"`,
    },
    path: { workspaceId, objectId: secondUpload.data.objectId },
    body: {
      fileId,
      revisionId: revisionId2,
      path: 'assets/icon.png',
      digest: secondUpload.data.digest,
      mutationId: randomUUID(),
      deviceId: 'integration-device',
    },
  });
  assert.equal(responseOf(updated.response).status, 200);

  // Both old revision and new revision remain accessible
  const readOld = await getAttachmentRevision({
    headers: browser(cookie),
    path: { workspaceId, revisionId: revisionId1 },
  });
  assert.equal(responseOf(readOld.response).status, 200);
  assert.equal(
    responseOf(readOld.response).headers.get('content-type'),
    'image/png',
  );

  const readNew = await getAttachmentRevision({
    headers: browser(cookie),
    path: { workspaceId, revisionId: revisionId2 },
  });
  assert.equal(responseOf(readNew.response).status, 200);
  assert.equal(
    responseOf(readNew.response).headers.get('content-type'),
    'image/webp',
  );
});

await test('idempotent replay and duplicate finalization validation', async () => {
  const file = new File([sampleJpegBytes], 'idempotent.jpg', {
    type: 'image/jpeg',
  });
  const uploaded = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file },
  });
  assert.ok(uploaded.data);

  const fileId = randomUUID();
  const revisionId = randomUUID();
  const mutationId = randomUUID();
  const payload = {
    fileId,
    revisionId,
    path: 'assets/idempotent.jpg',
    digest: uploaded.data.digest,
    mutationId,
    deviceId: 'integration-device',
  };

  const firstCall = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId: uploaded.data.objectId },
    body: payload,
  });
  assert.equal(responseOf(firstCall.response).status, 200);

  // Replay with same mutationId and same payload succeeds (idempotent result)
  const replayCall = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId: uploaded.data.objectId },
    body: payload,
  });
  assert.equal(responseOf(replayCall.response).status, 200);
  assert.equal(replayCall.data?.revision.revisionId, revisionId);

  // Same mutationId with different payload is rejected with mutation_reused
  const reusedCall = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId: uploaded.data.objectId },
    body: {
      ...payload,
      path: 'assets/different-path.jpg',
    },
  });
  assert.equal(responseOf(reusedCall.response).status, 409);
  assert.equal(problemCode(reusedCall.error), 'mutation_reused');

  // Finalizing with wrong expected digest is rejected with invalid_content
  const wrongDigestCall = await finalizeAttachment({
    headers: {
      ...browser(cookie),
      'if-match': `"${revisionId}"`,
    },
    path: { workspaceId, objectId: uploaded.data.objectId },
    body: {
      ...payload,
      revisionId: randomUUID(),
      mutationId: randomUUID(),
      digest:
        '0000000000000000000000000000000000000000000000000000000000000000',
    },
  });
  assert.equal(responseOf(wrongDigestCall.response).status, 422);
  assert.equal(problemCode(wrongDigestCall.error), 'invalid_content');
});

await test('deduplicate content inside one workspace', async () => {
  const file1 = new File([samplePngBytes], 'copy1.png', { type: 'image/png' });
  const file2 = new File([samplePngBytes], 'copy2.png', { type: 'image/png' });

  const upload1 = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file: file1 },
  });
  assert.ok(upload1.data);

  const upload2 = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: { file: file2 },
  });
  assert.ok(upload2.data);

  assert.notEqual(upload1.data.objectId, upload2.data.objectId);
  assert.equal(upload1.data.digest, upload2.data.digest);

  const rev1 = randomUUID();
  const rev2 = randomUUID();

  const fin1 = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId: upload1.data.objectId },
    body: {
      fileId: randomUUID(),
      revisionId: rev1,
      path: 'assets/copy1.png',
      digest: upload1.data.digest,
      ...mutationIds(),
    },
  });
  assert.equal(responseOf(fin1.response).status, 200);

  const fin2 = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId: upload2.data.objectId },
    body: {
      fileId: randomUUID(),
      revisionId: rev2,
      path: 'assets/copy2.png',
      digest: upload2.data.digest,
      ...mutationIds(),
    },
  });
  assert.equal(responseOf(fin2.response).status, 200);

  // Both revisions resolve the same binary payload
  const read1 = await getAttachmentRevision({
    headers: browser(cookie),
    path: { workspaceId, revisionId: rev1 },
  });
  const read2 = await getAttachmentRevision({
    headers: browser(cookie),
    path: { workspaceId, revisionId: rev2 },
  });
  assert.equal(responseOf(read1.response).status, 200);
  assert.equal(responseOf(read2.response).status, 200);
});

await test('enforce storage quota on attachment finalization', async () => {
  // Control reserve is 1 MiB (1048576 bytes). Setting quota to reserve + 3000 bytes
  // allows one revision (which incurs 1536 bytes metadata overhead + 470 bytes content),
  // but rejects a second attachment write that exceeds the remaining headroom.
  const quotaWorkspaceId = randomUUID();
  await seedWorkspace(
    database,
    quotaWorkspaceId,
    [{ accountId: ownerAccountId, role: 'owner' }],
    (1n << 20n) + 3000n,
  );

  // samplePngBytes is ~470 bytes, which fits inside 1024 bytes
  const smallUpload = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId: quotaWorkspaceId },
    body: {
      file: new File([samplePngBytes], 'small.png', { type: 'image/png' }),
    },
  });
  assert.ok(smallUpload.data);

  const smallFinalize = await finalizeAttachment({
    headers: browser(cookie),
    path: {
      workspaceId: quotaWorkspaceId,
      objectId: smallUpload.data.objectId,
    },
    body: {
      fileId: randomUUID(),
      revisionId: randomUUID(),
      path: 'assets/small.png',
      digest: smallUpload.data.digest,
      ...mutationIds(),
    },
  });
  assert.equal(responseOf(smallFinalize.response).status, 200);

  // Second attachment exceeds the remaining quota
  const secondUpload = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId: quotaWorkspaceId },
    body: {
      file: new File([samplePngBytes], 'overflow.png', { type: 'image/png' }),
    },
  });
  assert.ok(secondUpload.data);

  const overflowFinalize = await finalizeAttachment({
    headers: browser(cookie),
    path: {
      workspaceId: quotaWorkspaceId,
      objectId: secondUpload.data.objectId,
    },
    body: {
      fileId: randomUUID(),
      revisionId: randomUUID(),
      path: 'assets/overflow.png',
      digest: secondUpload.data.digest,
      ...mutationIds(),
    },
  });
  assert.equal(responseOf(overflowFinalize.response).status, 413);
  assert.equal(problemCode(overflowFinalize.error), 'quota_exceeded');
});

await test('deny cross-workspace attachment access', async () => {
  // Seed a second workspace where owner has no membership
  const foreignWorkspaceId = randomUUID();
  const otherAccountId = randomUUID();
  await seedWorkspace(database, foreignWorkspaceId, [
    { accountId: otherAccountId, role: 'owner' },
  ]);

  // Upload to foreign workspace is forbidden
  const forbiddenUpload = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId: foreignWorkspaceId },
    body: {
      file: new File([samplePngBytes], 'test.png', { type: 'image/png' }),
    },
  });
  assert.equal(responseOf(forbiddenUpload.response).status, 403);

  // Upload to valid workspace
  const validUpload = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      file: new File([samplePngBytes], 'test.png', { type: 'image/png' }),
    },
  });
  assert.ok(validUpload.data);

  // Attempting to finalize valid workspace object inside foreign workspace is forbidden
  const crossFinalize = await finalizeAttachment({
    headers: browser(cookie),
    path: {
      workspaceId: foreignWorkspaceId,
      objectId: validUpload.data.objectId,
    },
    body: {
      fileId: randomUUID(),
      revisionId: randomUUID(),
      path: 'assets/cross.png',
      digest: validUpload.data.digest,
      ...mutationIds(),
    },
  });
  assert.equal(responseOf(crossFinalize.response).status, 403);
});

await test('reclaim unreferenced temporary and finalized objects older than 24 hours', async () => {
  // 1. Upload a temporary object without finalizing
  const tempUpload = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      file: new File([samplePngBytes], 'orphan.png', { type: 'image/png' }),
    },
  });
  assert.ok(tempUpload.data);
  const tempObjectId = tempUpload.data.objectId;
  const tempFilePath = attachments.temporaryPath(tempObjectId);
  assert.ok(existsSync(tempFilePath), 'temporary upload file exists on disk');

  // 2. Upload and finalize an object into a revision
  const keptUpload = await uploadAttachment({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      file: new File([sampleJpegBytes], 'kept.jpg', { type: 'image/jpeg' }),
    },
  });
  assert.ok(keptUpload.data);
  const keptRevisionId = randomUUID();
  const keptFinalize = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId: keptUpload.data.objectId },
    body: {
      fileId: randomUUID(),
      revisionId: keptRevisionId,
      path: 'assets/kept.jpg',
      digest: keptUpload.data.digest,
      ...mutationIds(),
    },
  });
  assert.equal(responseOf(keptFinalize.response).status, 200);
  const keptFilePath = attachments.immutablePath(
    workspaceId,
    keptUpload.data.digest,
  );
  assert.ok(
    existsSync(keptFilePath),
    'finalized file exists in immutable storage',
  );

  // Reclaim at current time reclaims nothing because objects are fresh (< 24 hours)
  const reclaimedNow = await attachments.reclaimAttachments(new Date());
  assert.equal(reclaimedNow, 0);
  assert.ok(existsSync(tempFilePath), 'fresh temporary file is retained');
  assert.ok(existsSync(keptFilePath), 'fresh finalized file is retained');

  // Reclaim with clock advanced 25 hours
  const future = new Date(Date.now() + 25 * 60 * 60 * 1000);
  const reclaimedLater = await attachments.reclaimAttachments(future);
  assert.ok(reclaimedLater >= 1, 'abandoned temporary object is reclaimed');

  // Temporary file was unlinked
  assert.equal(
    existsSync(tempFilePath),
    false,
    'abandoned temporary file is removed',
  );

  // Finalized object referenced by the revision remains intact
  assert.ok(existsSync(keptFilePath), 'referenced finalized file is retained');

  // Reading the kept revision still works
  const readKept = await getAttachmentRevision({
    headers: browser(cookie),
    path: { workspaceId, revisionId: keptRevisionId },
  });
  assert.equal(responseOf(readKept.response).status, 200);

  // Attempting to finalize the reclaimed temporary object now fails
  const finalizeReclaimed = await finalizeAttachment({
    headers: browser(cookie),
    path: { workspaceId, objectId: tempObjectId },
    body: {
      fileId: randomUUID(),
      revisionId: randomUUID(),
      path: 'assets/orphan.png',
      digest: tempUpload.data.digest,
      ...mutationIds(),
    },
  });
  assert.equal(responseOf(finalizeReclaimed.response).status, 404);
});

await test('cleanup race safety on concurrent invocations', async () => {
  const future = new Date(Date.now() + 30 * 60 * 60 * 1000);
  // Concurrently invoking reclaimAttachments does not cause errors or deadlock
  const results = await Promise.all([
    attachments.reclaimAttachments(future),
    attachments.reclaimAttachments(future),
  ]);
  assert.ok(results.every((count) => typeof count === 'number'));
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
