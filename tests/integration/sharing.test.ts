/**
 * Pinned public sharing integration checks against a real server,
 * a real database, and real sessions.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acceptInvitation,
  configureClient,
  createFile,
  createShare,
  deleteFile,
  finalizeAttachment,
  getAccount,
  getPublicAttachment,
  getPublicShare,
  inviteMember,
  listShares,
  listWorkspaces,
  revokeShare,
  signInWithPassword,
  updateFile,
  updateMember,
  updateShare,
  uploadAttachment,
} from '@notesapp/api-client';
import {
  bootstrapOwner,
  createAuth,
  createAuthPool,
  createAuthProtocol,
  createHandlers,
  createIdentityAdapter,
  createInvitationAccounts,
  loadServerConfig,
  type ServerConfig,
} from '@notesapp/server';
import {
  openAttachmentStore,
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import sharp from 'sharp';
import { createDisposableDatabase } from './support/database.ts';
import { LogRecorder, startTestServer } from './support/server.ts';

function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

function problemCode(error: unknown): string {
  const code = readProperty(error, 'code');
  return typeof code === 'string' ? code : '';
}

function cookieHeader(values: readonly string[]): string {
  return values
    .map((entry) => (entry.split(';')[0] ?? '').trim())
    .filter((entry) => entry !== '' && !entry.endsWith('='))
    .join('; ');
}

function browser(cookie: string): Record<string, string> {
  return { origin: 'https://notes.test', cookie };
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-sharing-test-'));

const identity = openIdentityStore(database.runtimeUrl);
const content = openWorkspaceStore(database.runtimeUrl, { poolSize: 4 });
const attachments = openAttachmentStore(database.runtimeUrl, storageRoot, {
  poolSize: 4,
});

function environment(): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'https://notes.test',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'sharing-test-secret-value-0123456789abcd',
    NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost,notes.test',
    NOTESAPP_LOG_LEVEL: 'info',
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
const invitations = createInvitationAccounts(config, {
  identity,
  pool: authPool,
  resolveActor: (request) => adapter.resolveActor(request),
});

const logs = new LogRecorder();
const server = await startTestServer({
  environment: environment(),
  handlers: (value) =>
    createHandlers(value, undefined, {
      store: identity,
      content,
      attachments,
      invitations,
    }),
  identity: adapter.resolver,
  logStream: logs,
  protocols: [createAuthProtocol(config, auth.auth)],
});
configureClient(server.baseUrl, undefined);

const ownerEmail = 'sharing-owner@notes.invalid';
const ownerPassword = 'owner-password-123456';
await bootstrapOwner({
  config,
  email: ownerEmail,
  name: 'Sharing Owner',
  password: ownerPassword,
});

const ownerSignedIn = await signInWithPassword({
  headers: { origin: 'https://notes.test' },
  body: { email: ownerEmail, password: ownerPassword },
});
const ownerCookie = cookieHeader(
  responseOf(ownerSignedIn.response).headers.getSetCookie(),
);
assert.ok(ownerCookie.length > 0);

const ownerWorkspaces = await listWorkspaces({
  headers: browser(ownerCookie),
});
const workspaceId = ownerWorkspaces.data?.workspaces[0]?.workspaceId ?? '';
assert.match(workspaceId, /^[0-9a-f-]{36}$/);

// Invite an admin and an editor for access checks
const adminEmail = 'sharing-admin@notes.invalid';
const adminPassword = 'admin-password-123456';
const adminInvite = await inviteMember({
  headers: browser(ownerCookie),
  path: { workspaceId },
  body: { email: adminEmail, role: 'admin' },
});
assert.ok(adminInvite.data);
const adminToken = adminInvite.data.token ?? '';
assert.ok(adminToken.length > 0);
await acceptInvitation({
  headers: { origin: 'https://notes.test' },
  body: {
    token: adminToken,
    password: adminPassword,
  },
});
const adminSignedIn = await signInWithPassword({
  headers: { origin: 'https://notes.test' },
  body: { email: adminEmail, password: adminPassword },
});
const adminCookie = cookieHeader(
  responseOf(adminSignedIn.response).headers.getSetCookie(),
);
const adminAccount = await getAccount({ headers: browser(adminCookie) });
const adminAccountId = adminAccount.data?.accountId ?? '';

const editorEmail = 'sharing-editor@notes.invalid';
const editorPassword = 'editor-password-123456';
const editorInvite = await inviteMember({
  headers: browser(ownerCookie),
  path: { workspaceId },
  body: { email: editorEmail, role: 'editor' },
});
assert.ok(editorInvite.data);
const editorToken = editorInvite.data.token ?? '';
assert.ok(editorToken.length > 0);
await acceptInvitation({
  headers: { origin: 'https://notes.test' },
  body: {
    token: editorToken,
    password: editorPassword,
  },
});
const editorSignedIn = await signInWithPassword({
  headers: { origin: 'https://notes.test' },
  body: { email: editorEmail, password: editorPassword },
});
const editorCookie = cookieHeader(
  responseOf(editorSignedIn.response).headers.getSetCookie(),
);

const samplePngBytes = await sharp({
  create: {
    width: 64,
    height: 64,
    channels: 4,
    background: { r: 0, g: 128, b: 255, alpha: 1 },
  },
})
  .png()
  .toBuffer();

await test('create and read pinned public share with security headers and log redaction', async () => {
  const fileId = randomUUID();
  const revisionId = randomUUID();
  const created = await createFile({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      revisionId,
      path: 'public-note.md',
      text: '# Welcome\nThis is a shared document.\n',
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });
  assert.equal(responseOf(created.response).status, 201);

  const shareResult = await createShare({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      pinnedRevisionId: revisionId,
      expiresAt: null,
    },
  });
  assert.equal(responseOf(shareResult.response).status, 201);
  assert.ok(shareResult.data);
  const shareData = shareResult.data;
  assert.match(shareData.shareId, /^[0-9a-f-]{36}$/);
  assert.equal(shareData.fileId, fileId);
  assert.equal(shareData.pinnedRevisionId, revisionId);
  assert.equal(shareData.revokedAt, null);
  assert.equal(shareData.expiresAt, null);
  assert.ok(shareData.url);
  assert.match(shareData.url, /^https:\/\/notes\.test\/s\/[A-Za-z0-9_-]+$/);

  const token = shareData.url.split('/s/')[1] ?? '';
  assert.ok(token.length > 0);

  // Anonymous user reads the public HTML
  const publicResult = await getPublicShare({
    path: { token },
  });
  const res = responseOf(publicResult.response);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.ok(csp.includes("default-src 'none'"));

  const html = publicResult.data ?? '';
  assert.ok(html.includes('This is a shared document.'));
  assert.ok(html.includes('<title>public-note</title>'));

  // Verify access log redaction: raw token is never logged
  const rawTokenFound = logs.lines.some((line) => line.includes(token));
  assert.equal(
    rawTokenFound,
    false,
    'The raw token must not appear in server logs.',
  );
  const redactedLogFound = logs.lines.some((line) =>
    line.includes('/s/[redacted]'),
  );
  assert.equal(
    redactedLogFound,
    true,
    'The redacted URL /s/[redacted] must appear in server logs.',
  );
});

await test('script and dangerous HTML content is sanitized in public output', async () => {
  const fileId = randomUUID();
  const revisionId = randomUUID();
  await createFile({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      revisionId,
      path: 'xss-note.md',
      text: '# Malicious\n<script>alert("xss")</script>\n[Click](javascript:alert(1))\n',
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  const shareResult = await createShare({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      pinnedRevisionId: revisionId,
      expiresAt: null,
    },
  });
  assert.ok(shareResult.data?.url);
  const token = shareResult.data.url.split('/s/')[1] ?? '';

  const publicResult = await getPublicShare({ path: { token } });
  assert.equal(responseOf(publicResult.response).status, 200);
  const html = publicResult.data ?? '';
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('javascript:'), false);
});

await test('private target note titles and metadata are not resolved or leaked', async () => {
  const privateFileId = randomUUID();
  await createFile({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId: privateFileId,
      revisionId: randomUUID(),
      path: 'secret-plan.md',
      text: '# Secret Information\nInternal data only.\n',
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  const publicFileId = randomUUID();
  const revisionId = randomUUID();
  await createFile({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId: publicFileId,
      revisionId,
      path: 'links-note.md',
      text: `# Overview\nSee [Target](/notes/${privateFileId}) and [[Secret Plan]].\n`,
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  const shareResult = await createShare({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId: publicFileId,
      pinnedRevisionId: revisionId,
      expiresAt: null,
    },
  });
  assert.ok(shareResult.data?.url);
  const token = shareResult.data.url.split('/s/')[1] ?? '';

  const publicResult = await getPublicShare({ path: { token } });
  assert.equal(responseOf(publicResult.response).status, 200);
  const html = publicResult.data ?? '';
  assert.equal(html.includes('Internal data only'), false);
  assert.equal(html.includes('Target'), true);
});

await test('later edits stay unpublished until an explicit publication update', async () => {
  const fileId = randomUUID();
  const initialRevisionId = randomUUID();
  await createFile({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      revisionId: initialRevisionId,
      path: 'draft-flow.md',
      text: '# Initial Version\nOnly this text should be visible.\n',
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  const shareResult = await createShare({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      pinnedRevisionId: initialRevisionId,
      expiresAt: null,
    },
  });
  assert.ok(shareResult.data?.url);
  const shareId = shareResult.data.shareId;
  const token = shareResult.data.url.split('/s/')[1] ?? '';

  // Update note to a newer head revision
  const secondRevisionId = randomUUID();
  await updateFile({
    headers: { ...browser(ownerCookie), 'if-match': `"${initialRevisionId}"` },
    path: { workspaceId, fileId },
    body: {
      revisionId: secondRevisionId,
      path: 'draft-flow.md',
      text: '# Second Version\nThis text is a private draft.\n',
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  // Public link still serves initial revision
  const public1 = await getPublicShare({ path: { token } });
  assert.equal(responseOf(public1.response).status, 200);
  assert.ok(public1.data?.includes('Only this text should be visible.'));
  assert.equal(public1.data?.includes('This text is a private draft.'), false);

  // Explicit publication update pins the second revision
  const updateResult = await updateShare({
    headers: browser(ownerCookie),
    path: { workspaceId, shareId },
    body: {
      fileId,
      pinnedRevisionId: secondRevisionId,
      expiresAt: null,
    },
  });
  assert.equal(responseOf(updateResult.response).status, 200);
  // Update response does not expose the token URL
  assert.equal(readProperty(updateResult.data, 'url'), undefined);

  // Now public link serves the updated revision
  const public2 = await getPublicShare({ path: { token } });
  assert.equal(responseOf(public2.response).status, 200);
  assert.ok(public2.data?.includes('This text is a private draft.'));
  assert.equal(
    public2.data?.includes('Only this text should be visible.'),
    false,
  );
});

await test('public attachment access is allowed only for pinned revision attachments', async () => {
  // Upload attachment 1
  const file1 = new File([samplePngBytes], 'diagram.png', {
    type: 'image/png',
  });
  const up1 = await uploadAttachment({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: { file: file1 },
  });
  assert.ok(up1.data);
  const attachFileId1 = randomUUID();
  const attachRevId1 = randomUUID();
  await finalizeAttachment({
    headers: browser(ownerCookie),
    path: { workspaceId, objectId: up1.data.objectId },
    body: {
      fileId: attachFileId1,
      revisionId: attachRevId1,
      path: 'assets/diagram.png',
      digest: up1.data.digest,
      mutationId: randomUUID(),
      deviceId: 'device-test',
      message: null,
    },
  });

  // Upload attachment 2 (not referenced in the note)
  const file2 = new File([samplePngBytes], 'other.png', {
    type: 'image/png',
  });
  const up2 = await uploadAttachment({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: { file: file2 },
  });
  assert.ok(up2.data);
  const attachFileId2 = randomUUID();
  const attachRevId2 = randomUUID();
  await finalizeAttachment({
    headers: browser(ownerCookie),
    path: { workspaceId, objectId: up2.data.objectId },
    body: {
      fileId: attachFileId2,
      revisionId: attachRevId2,
      path: 'assets/other.png',
      digest: up2.data.digest,
      mutationId: randomUUID(),
      deviceId: 'device-test',
      message: null,
    },
  });

  // Create note referencing only attachment 1
  const noteFileId = randomUUID();
  const noteRevId = randomUUID();
  await createFile({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId: noteFileId,
      revisionId: noteRevId,
      path: 'note-with-image.md',
      text: `# Note with image\n![Diagram](/attachments/${attachRevId1})\n`,
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  const shareResult = await createShare({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId: noteFileId,
      pinnedRevisionId: noteRevId,
      expiresAt: null,
    },
  });
  assert.ok(shareResult.data?.url);
  const token = shareResult.data.url.split('/s/')[1] ?? '';

  // Public attachment download for referenced revision succeeds
  const attachRes = await getPublicAttachment({
    path: { token, revisionId: attachRevId1 },
  });
  const res = responseOf(attachRes.response);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal(
    res.headers.get('content-length'),
    String(samplePngBytes.length),
  );
  assert.equal(
    res.headers.get('etag'),
    `"sha256-${sha256Hex(samplePngBytes)}"`,
  );

  // Public attachment download for unreferenced revision 2 fails with 404
  const unrefRes = await getPublicAttachment({
    path: { token, revisionId: attachRevId2 },
  });
  assert.equal(responseOf(unrefRes.response).status, 404);
  assert.equal(problemCode(unrefRes.error), 'not_found');
});

await test('expired public share returns 404', async () => {
  const fileId = randomUUID();
  const revisionId = randomUUID();
  await createFile({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      revisionId,
      path: 'expiring-note.md',
      text: '# Expiring\nWill expire quickly.\n',
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  // Set expiry to 1 second in the future
  const futureDate = new Date(Date.now() + 1000).toISOString();
  const shareResult = await createShare({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      pinnedRevisionId: revisionId,
      expiresAt: futureDate,
    },
  });
  assert.ok(shareResult.data?.url);
  const token = shareResult.data.url.split('/s/')[1] ?? '';

  // Initial read before expiry succeeds
  const beforeExpiry = await getPublicShare({ path: { token } });
  assert.equal(responseOf(beforeExpiry.response).status, 200);

  // Wait 1200 ms for expiry to pass
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const afterExpiry = await getPublicShare({ path: { token } });
  assert.equal(responseOf(afterExpiry.response).status, 404);
  assert.equal(problemCode(afterExpiry.error), 'not_found');
});

await test('explicit revocation makes public page and attachment unavailable', async () => {
  const fileId = randomUUID();
  const revisionId = randomUUID();
  await createFile({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      revisionId,
      path: 'revocation-note.md',
      text: '# Revoke Me\nSoon to be revoked.\n',
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  const shareResult = await createShare({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      pinnedRevisionId: revisionId,
      expiresAt: null,
    },
  });
  assert.ok(shareResult.data);
  const { shareId, url } = shareResult.data;
  assert.ok(url);
  const token = url.split('/s/')[1] ?? '';

  const revoked = await revokeShare({
    headers: browser(ownerCookie),
    path: { workspaceId, shareId },
  });
  assert.equal(responseOf(revoked.response).status, 200);
  assert.ok(revoked.data?.revokedAt !== null);

  const publicRes = await getPublicShare({ path: { token } });
  assert.equal(responseOf(publicRes.response).status, 404);
  assert.equal(problemCode(publicRes.error), 'not_found');
  assert.equal(readProperty(publicRes.error, 'instance'), '/s/redacted');
});

await test('deleting the shared file revokes public access', async () => {
  const fileId = randomUUID();
  const revisionId = randomUUID();
  await createFile({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      revisionId,
      path: 'delete-target.md',
      text: '# Target for deletion\nContent\n',
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  const shareResult = await createShare({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      pinnedRevisionId: revisionId,
      expiresAt: null,
    },
  });
  assert.ok(shareResult.data?.url);
  const token = shareResult.data.url.split('/s/')[1] ?? '';

  // Delete file
  await deleteFile({
    headers: { ...browser(ownerCookie), 'if-match': `"${revisionId}"` },
    path: { workspaceId, fileId },
    body: {
      revisionId: randomUUID(),
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  const publicRes = await getPublicShare({ path: { token } });
  assert.equal(responseOf(publicRes.response).status, 404);
  assert.equal(problemCode(publicRes.error), 'not_found');
});

await test('creator downgrade to editor revokes public shares', async () => {
  const fileId = randomUUID();
  const revisionId = randomUUID();
  await createFile({
    headers: browser(adminCookie),
    path: { workspaceId },
    body: {
      fileId,
      revisionId,
      path: 'admin-note.md',
      text: '# Admin note\nAdmin published this.\n',
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  const shareResult = await createShare({
    headers: browser(adminCookie),
    path: { workspaceId },
    body: {
      fileId,
      pinnedRevisionId: revisionId,
      expiresAt: null,
    },
  });
  assert.ok(shareResult.data?.url);
  const token = shareResult.data.url.split('/s/')[1] ?? '';

  // Admin access check: public share is active
  const beforeDowngrade = await getPublicShare({ path: { token } });
  assert.equal(responseOf(beforeDowngrade.response).status, 200);

  // Owner downgrades admin to editor
  const updateRole = await updateMember({
    headers: browser(ownerCookie),
    path: { workspaceId, accountId: adminAccountId },
    body: { role: 'editor' },
  });
  assert.equal(responseOf(updateRole.response).status, 200);

  // Now public share must be revoked
  const afterDowngrade = await getPublicShare({ path: { token } });
  assert.equal(responseOf(afterDowngrade.response).status, 404);
  assert.equal(problemCode(afterDowngrade.error), 'not_found');
});

await test('editor role cannot manage shares and branch publication is rejected', async () => {
  const fileId = randomUUID();
  const revisionId = randomUUID();
  await createFile({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      revisionId,
      path: 'permissions-check.md',
      text: '# Permissions\nTesting roles.\n',
      deviceId: 'device-test',
      mutationId: randomUUID(),
    },
  });

  // Editor cannot create share
  const editorCreate = await createShare({
    headers: browser(editorCookie),
    path: { workspaceId },
    body: {
      fileId,
      pinnedRevisionId: revisionId,
      expiresAt: null,
    },
  });
  assert.equal(responseOf(editorCreate.response).status, 403);
  assert.equal(problemCode(editorCreate.error), 'forbidden');

  // Editor cannot list shares
  const editorList = await listShares({
    headers: browser(editorCookie),
    path: { workspaceId },
  });
  assert.equal(responseOf(editorList.response).status, 403);
  assert.equal(problemCode(editorList.error), 'forbidden');

  // Attempting to publish an unaccepted/random revision ID fails with 404
  const randomRevId = randomUUID();
  const branchPublish = await createShare({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      fileId,
      pinnedRevisionId: randomRevId,
      expiresAt: null,
    },
  });
  assert.equal(responseOf(branchPublish.response).status, 404);
  assert.equal(problemCode(branchPublish.error), 'not_found');
});

// Teardown
await server.close();
await invitations.close();
await auth.close();
await authPool.end();
await attachments.close();
await content.close();
await identity.close();
await rm(storageRoot, { recursive: true, force: true });
await database.destroy();
