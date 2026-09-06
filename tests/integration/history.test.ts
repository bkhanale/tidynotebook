/**
 * History, checkpoint, branch, restore, and purge checks against a real
 * server, a real database, and real sessions.
 *
 * Every application call goes through a generated operation function.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acceptInvitation,
  configureClient,
  createCheckpoint,
  createFile,
  deleteFile,
  getAccount,
  getFile,
  getRevision,
  inviteMember,
  listBranches,
  listFiles,
  listHistory,
  listWorkspaces,
  previewPurge,
  purgeFiles,
  resolveBranches,
  restoreRevision,
  signInWithPassword,
  submitBranch,
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
  createInvitationAccounts,
  loadServerConfig,
  type ServerConfig,
} from '@notesapp/server';
import {
  openAttachmentStore,
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import { createDisposableDatabase } from './support/database.ts';
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
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-history-test-'));

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
    NOTESAPP_AUTH_SECRET: 'history-test-secret-value-0123456789abcd',
    NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost,notes.test',
    NOTESAPP_LOG_LEVEL: 'error',
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
  protocols: [createAuthProtocol(config, auth.auth)],
});
configureClient(server.baseUrl, undefined);

const ownerEmail = 'history-owner@notes.invalid';
const ownerPassword = 'owner-password-123456';
await bootstrapOwner({
  config,
  email: ownerEmail,
  name: 'History Owner',
  password: ownerPassword,
});

const ownerSignedIn = await signInWithPassword({
  headers: { origin: 'https://notes.test' },
  body: { email: ownerEmail, password: ownerPassword },
});
const ownerCookie = cookieHeader(
  responseOf(ownerSignedIn.response).headers.getSetCookie(),
);
assert.ok(ownerCookie.length > 0, 'the test needs an owner session cookie');

const account = await getAccount({ headers: browser(ownerCookie) });
const ownerAccountId = account.data?.accountId ?? '';
assert.match(ownerAccountId, /^[0-9a-f-]{36}$/);

const listed = await listWorkspaces({ headers: browser(ownerCookie) });
const workspaceId = listed.data?.workspaces[0]?.workspaceId ?? '';
assert.match(workspaceId, /^[0-9a-f-]{36}$/);

// Invite an editor member to verify authorization rules such as owner-only purge.
const memberEmail = 'history-editor@notes.invalid';
const memberPassword = 'editor-password-123456';
const invited = await inviteMember({
  headers: browser(ownerCookie),
  path: { workspaceId },
  body: { email: memberEmail, role: 'editor' },
});
assert.equal(invited.error, undefined);
const inviteToken = invited.data?.token ?? '';
assert.ok(inviteToken.length > 0);

const memberAccepted = await acceptInvitation({
  headers: { origin: 'https://notes.test' },
  body: { token: inviteToken, password: memberPassword },
});
assert.equal(memberAccepted.error, undefined);
const memberCookie = cookieHeader(
  responseOf(memberAccepted.response).headers.getSetCookie(),
);
assert.ok(memberCookie.length > 0, 'the test needs a member session cookie');

/** The client identifiers that every write carries. */
function mutationIds(): {
  revisionId: string;
  mutationId: string;
  deviceId: string;
  clientTime: string;
} {
  return {
    revisionId: randomUUID(),
    mutationId: randomUUID(),
    deviceId: 'integration-device',
    clientTime: new Date().toISOString(),
  };
}

/** Creates one note file and returns its identifiers and entity tag. */
async function newFile(
  path: string,
  text = `# ${path}\n`,
  cookie = ownerCookie,
): Promise<{ fileId: string; revisionId: string; tag: string }> {
  const fileId = randomUUID();
  const ids = mutationIds();
  const created = await createFile({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      fileId,
      path,
      text,
      revisionId: ids.revisionId,
      mutationId: ids.mutationId,
      deviceId: ids.deviceId,
    },
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

await test('createCheckpoint with draft content creates a new revision', async () => {
  const file = await newFile('checkpoint-draft.md', '# Initial Text\n');
  const draftText = '# Checkpoint Text\n';
  const draftDigest = await contentDigest(draftText);

  const ids = mutationIds();
  const created = await createCheckpoint({
    headers: {
      ...browser(ownerCookie),
      'if-match': file.tag,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      mutationId: ids.mutationId,
      deviceId: ids.deviceId,
      clientTime: ids.clientTime,
      revisionId: ids.revisionId,
      name: 'Draft Checkpoint',
      content: {
        kind: 'markdown',
        digest: draftDigest,
        text: draftText,
      },
    },
  });

  assert.equal(created.error, undefined, JSON.stringify(created.error));
  assert.equal(responseOf(created.response).status, 200);
  assert.equal(created.data?.revisions.length, 1);
  const acceptedRevision = created.data?.revisions[0];
  assert.equal(acceptedRevision?.revisionId, ids.revisionId);

  const fetched = await getRevision({
    headers: browser(ownerCookie),
    path: { workspaceId, revisionId: ids.revisionId },
  });
  assert.equal(fetched.error, undefined);
  assert.equal(fetched.data?.message, 'Draft Checkpoint');
  assert.deepEqual(fetched.data?.parents, [file.revisionId]);
});

await test('createCheckpoint without content tags the current head', async () => {
  const file = await newFile('checkpoint-head.md', '# Head Text\n');

  const ids = mutationIds();
  const created = await createCheckpoint({
    headers: {
      ...browser(ownerCookie),
      'if-match': file.tag,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      mutationId: ids.mutationId,
      deviceId: ids.deviceId,
      clientTime: ids.clientTime,
      name: 'Release 1.0',
    },
  });

  assert.equal(created.error, undefined, JSON.stringify(created.error));
  assert.equal(responseOf(created.response).status, 200);

  const checkpointRevId = created.data?.revisions[0]?.revisionId ?? '';
  assert.ok(checkpointRevId.length > 0);

  const fetched = await getRevision({
    headers: browser(ownerCookie),
    path: { workspaceId, revisionId: checkpointRevId },
  });
  assert.equal(fetched.error, undefined);
  assert.equal(fetched.data?.message, 'Release 1.0');
});

await test('listHistory returns revisions with checkpoint filters and pagination', async () => {
  const file = await newFile('history-sample.md', '# Initial Revision\n');

  // Add a regular second revision
  const updateIds = mutationIds();
  const updated = await updateFile({
    headers: {
      ...browser(ownerCookie),
      'if-match': file.tag,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      text: '# Second Revision\n',
      revisionId: updateIds.revisionId,
      mutationId: updateIds.mutationId,
      deviceId: updateIds.deviceId,
    },
  });
  assert.equal(updated.error, undefined);
  const secondTag = responseOf(updated.response).headers.get('etag') ?? '';

  // Add a checkpoint revision
  const cpText = '# Third Revision (Checkpoint)\n';
  const cpDigest = await contentDigest(cpText);
  const cpIds = mutationIds();
  const cp = await createCheckpoint({
    headers: {
      ...browser(ownerCookie),
      'if-match': secondTag,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      mutationId: cpIds.mutationId,
      deviceId: cpIds.deviceId,
      clientTime: cpIds.clientTime,
      revisionId: cpIds.revisionId,
      name: 'Important Milestone',
      content: {
        kind: 'markdown',
        digest: cpDigest,
        text: cpText,
      },
    },
  });
  assert.equal(cp.error, undefined);

  // List all history
  const fullHistory = await listHistory({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(fullHistory.error, undefined);
  assert.equal(fullHistory.data?.revisions.length, 3);
  assert.equal(fullHistory.data?.revisions[0]?.revisionId, cpIds.revisionId);
  assert.equal(fullHistory.data?.revisions[0]?.isCheckpoint, true);
  assert.equal(
    fullHistory.data?.revisions[0]?.checkpointName,
    'Important Milestone',
  );

  // Checkpoint metadata is reported in history
  const checkpointItem = fullHistory.data?.revisions.find(
    (r) => r.revisionId === cpIds.revisionId,
  );
  assert.equal(checkpointItem?.isCheckpoint, true);
  assert.equal(checkpointItem?.checkpointName, 'Important Milestone');

  // Pagination with limit
  const page1 = await listHistory({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
    query: { limit: 1 },
  });
  assert.equal(page1.error, undefined);
  assert.equal(page1.data?.revisions.length, 1);
  assert.ok(page1.data?.nextCursor);

  const page2 = await listHistory({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
    query: { limit: 1, cursor: page1.data?.nextCursor ?? undefined },
  });
  assert.equal(page2.error, undefined);
  assert.equal(page2.data?.revisions.length, 1);
  assert.equal(page2.data?.revisions[0]?.revisionId, updateIds.revisionId);
});

await test('submitBranch stores divergent revisions without advancing accepted head', async () => {
  const file = await newFile('branch-test.md', '# Base Revision\n');

  // Advance head on main
  const updateIds = mutationIds();
  const updated = await updateFile({
    headers: {
      ...browser(ownerCookie),
      'if-match': file.tag,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      text: '# Main Head\n',
      revisionId: updateIds.revisionId,
      mutationId: updateIds.mutationId,
      deviceId: updateIds.deviceId,
    },
  });
  assert.equal(updated.error, undefined);

  // Submit divergent branch branched from the base revision
  const branchText = '# Divergent Branch Revision\n';
  const branchDigest = await contentDigest(branchText);
  const branchRevId = randomUUID();
  const conflictGroupId = randomUUID();
  const branchMutationId = randomUUID();

  const branchSubmitted = await submitBranch({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      mutationId: branchMutationId,
      deviceId: 'device-offline',
      conflictGroupId,
      expectedHeads: {
        [file.fileId]: file.revisionId,
      },
      revisions: [
        {
          revisionId: branchRevId,
          fileId: file.fileId,
          parents: [file.revisionId],
          path: 'branch-test.md',
          deleted: false,
          clientTime: new Date().toISOString(),
          content: {
            kind: 'markdown',
            digest: branchDigest,
            text: branchText,
          },
        },
      ],
    },
  });
  assert.equal(branchSubmitted.error, undefined);
  assert.equal(responseOf(branchSubmitted.response).status, 200);

  // Verify accepted head did NOT advance
  const currentFile = await getFile({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(currentFile.error, undefined);
  assert.equal(currentFile.data?.headRevisionId, updateIds.revisionId);
  assert.equal(currentFile.data?.head?.text, '# Main Head\n');

  // List unresolved branches
  const openBranches = await listBranches({
    headers: browser(ownerCookie),
    path: { workspaceId },
    query: { fileId: file.fileId, state: 'unresolved' },
  });
  assert.equal(openBranches.error, undefined);
  assert.equal(openBranches.data?.branches.length, 1);
  assert.equal(openBranches.data?.branches[0]?.tipRevisionId, branchRevId);
  assert.equal(openBranches.data?.branches[0]?.baseRevisionId, file.revisionId);
  assert.equal(openBranches.data?.branches[0]?.state, 'unresolved');
});

await test('submitBranch for a branch-only file omits it from live paths', async () => {
  const newFileId = randomUUID();
  const branchRevId = randomUUID();
  const branchText = '# Brand New Offline Note\n';
  const branchDigest = await contentDigest(branchText);

  const submitted = await submitBranch({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'offline-device',
      conflictGroupId: randomUUID(),
      expectedHeads: {
        [newFileId]: null,
      },
      revisions: [
        {
          revisionId: branchRevId,
          fileId: newFileId,
          parents: [],
          path: 'offline-new.md',
          deleted: false,
          clientTime: new Date().toISOString(),
          content: {
            kind: 'markdown',
            digest: branchDigest,
            text: branchText,
          },
        },
      ],
    },
  });
  assert.equal(submitted.error, undefined);
  assert.equal(responseOf(submitted.response).status, 200);

  // Verify live files does NOT include offline-new.md
  const live = await listFiles({
    headers: browser(ownerCookie),
    path: { workspaceId },
  });
  assert.equal(live.error, undefined);
  const found = live.data?.files.find((f) => f.fileId === newFileId);
  assert.equal(found, undefined);
});

await test('resolveBranches resolves conflict, advances head, and marks branch resolved', async () => {
  const file = await newFile('merge-test.md', '# Initial Merge Base\n');

  // Main head moves forward
  const updateIds = mutationIds();
  const updated = await updateFile({
    headers: {
      ...browser(ownerCookie),
      'if-match': file.tag,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      text: '# Main Change\n',
      revisionId: updateIds.revisionId,
      mutationId: updateIds.mutationId,
      deviceId: updateIds.deviceId,
    },
  });
  assert.equal(updated.error, undefined);
  const mainHeadId = updateIds.revisionId;

  // Branch revision
  const branchText = '# Branch Change\n';
  const branchDigest = await contentDigest(branchText);
  const branchRevId = randomUUID();
  const conflictGroupId = randomUUID();

  const branchSub = await submitBranch({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'device-b',
      conflictGroupId,
      expectedHeads: {
        [file.fileId]: file.revisionId,
      },
      revisions: [
        {
          revisionId: branchRevId,
          fileId: file.fileId,
          parents: [file.revisionId],
          path: 'merge-test.md',
          deleted: false,
          clientTime: new Date().toISOString(),
          content: {
            kind: 'markdown',
            digest: branchDigest,
            text: branchText,
          },
        },
      ],
    },
  });
  assert.equal(branchSub.error, undefined);

  // Resolve conflict: resolution has parents [mainHeadId, branchRevId]
  const resolvedText = '# Merged Outcome\n';
  const resolvedDigest = await contentDigest(resolvedText);
  const resolutionRevId = randomUUID();
  const resolutionMutationId = randomUUID();

  const resolved = await resolveBranches({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      mutationId: resolutionMutationId,
      deviceId: 'device-resolver',
      clientTime: new Date().toISOString(),
      conflictGroupId,
      resolutions: [
        {
          fileId: file.fileId,
          expectedHead: mainHeadId,
          branchTip: branchRevId,
          revisionId: resolutionRevId,
          path: 'merge-test.md',
          deleted: false,
          content: {
            kind: 'markdown',
            digest: resolvedDigest,
            text: resolvedText,
          },
        },
      ],
    },
  });

  assert.equal(resolved.error, undefined, JSON.stringify(resolved.error));
  assert.equal(responseOf(resolved.response).status, 200);
  assert.equal(resolved.data?.resolvedBranchIds.length, 1);

  // Verify file head is now the resolution revision
  const currentFile = await getFile({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(currentFile.data?.headRevisionId, resolutionRevId);
  assert.equal(currentFile.data?.head?.text, '# Merged Outcome\n');
  assert.deepEqual(currentFile.data?.head?.parents, [mainHeadId, branchRevId]);

  // Verify branches for this file are resolved
  const openBranches = await listBranches({
    headers: browser(ownerCookie),
    path: { workspaceId },
    query: { fileId: file.fileId, state: 'unresolved' },
  });
  assert.equal(openBranches.data?.branches.length, 0);

  const closedBranches = await listBranches({
    headers: browser(ownerCookie),
    path: { workspaceId },
    query: { fileId: file.fileId, state: 'resolved' },
  });
  assert.equal(closedBranches.data?.branches.length, 1);
  assert.equal(closedBranches.data?.branches[0]?.state, 'resolved');
});

await test('resolveBranches fails when expectedHead moved concurrently', async () => {
  const file = await newFile('race-test.md', '# Race Base\n');

  // Submit branch
  const branchRevId = randomUUID();
  const branchText = '# Race Branch\n';
  const branchDigest = await contentDigest(branchText);
  const branchSub = await submitBranch({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'device-b',
      conflictGroupId: randomUUID(),
      expectedHeads: { [file.fileId]: file.revisionId },
      revisions: [
        {
          revisionId: branchRevId,
          fileId: file.fileId,
          parents: [file.revisionId],
          path: 'race-test.md',
          deleted: false,
          clientTime: new Date().toISOString(),
          content: {
            kind: 'markdown',
            digest: branchDigest,
            text: branchText,
          },
        },
      ],
    },
  });
  assert.equal(branchSub.error, undefined);

  // Advance head concurrently
  const updateIds = mutationIds();
  await updateFile({
    headers: {
      ...browser(ownerCookie),
      'if-match': file.tag,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      text: '# Head Moved\n',
      revisionId: updateIds.revisionId,
      mutationId: updateIds.mutationId,
      deviceId: updateIds.deviceId,
    },
  });

  // Attempt resolution stating the old head as expectedHead
  const resolvedDigest = await contentDigest('# Stale Resolution\n');
  const failedResolution = await resolveBranches({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'device-resolver',
      clientTime: new Date().toISOString(),
      resolutions: [
        {
          fileId: file.fileId,
          expectedHead: file.revisionId, // Stale! Current head is updateIds.revisionId
          branchTip: branchRevId,
          revisionId: randomUUID(),
          path: 'race-test.md',
          deleted: false,
          content: {
            kind: 'markdown',
            digest: resolvedDigest,
            text: '# Stale Resolution\n',
          },
        },
      ],
    },
  });

  assert.equal(responseOf(failedResolution.response).status, 412);
  assert.equal(problemCode(failedResolution.error), 'stale_head');

  // Branch must still be unresolved
  const branches = await listBranches({
    headers: browser(ownerCookie),
    path: { workspaceId },
    query: { fileId: file.fileId, state: 'unresolved' },
  });
  assert.equal(branches.data?.branches.length, 1);
});

await test('restoreRevision restores earlier revision without rewriting history', async () => {
  const originalText = '# Original Version 1\n';
  const file = await newFile('restore-test.md', originalText);
  const r1Id = file.revisionId;

  // Create Version 2
  const v2Ids = mutationIds();
  const v2Updated = await updateFile({
    headers: {
      ...browser(ownerCookie),
      'if-match': file.tag,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      text: '# Changed Version 2\n',
      revisionId: v2Ids.revisionId,
      mutationId: v2Ids.mutationId,
      deviceId: v2Ids.deviceId,
    },
  });
  assert.equal(v2Updated.error, undefined);
  const r2Id = v2Ids.revisionId;

  // Restore Version 1
  const restoreRevId = randomUUID();
  const restored = await restoreRevision({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'device-restorer',
      clientTime: new Date().toISOString(),
      targetRevisionId: r1Id,
      expectedHead: r2Id,
      revisionId: restoreRevId,
      message: 'Restored Version 1',
    },
  });

  assert.equal(restored.error, undefined, JSON.stringify(restored.error));
  assert.equal(responseOf(restored.response).status, 200);
  assert.equal(restored.data?.revisions[0]?.revisionId, restoreRevId);

  // Verify file head has the original content
  const restoredFile = await getFile({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(restoredFile.data?.headRevisionId, restoreRevId);
  assert.equal(restoredFile.data?.head?.text, originalText);
  assert.equal(restoredFile.data?.head?.restoredFrom, r1Id);
  assert.deepEqual(restoredFile.data?.head?.parents, [r2Id]);
});

await test('restoreRevision resurrects a deleted file', async () => {
  const originalText = '# File To Delete And Restore\n';
  const file = await newFile('resurrect-test.md', originalText);

  // Delete the file
  const delIds = mutationIds();
  const deleted = await deleteFile({
    headers: {
      ...browser(ownerCookie),
      'if-match': file.tag,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      revisionId: delIds.revisionId,
      mutationId: delIds.mutationId,
      deviceId: delIds.deviceId,
    },
  });
  assert.equal(deleted.error, undefined);

  // Verify file is deleted
  const checkDeleted = await getFile({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(responseOf(checkDeleted.response).status, 404);

  // Restore the pre-deletion revision
  const restoreRevId = randomUUID();
  const restored = await restoreRevision({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'device-restorer',
      clientTime: new Date().toISOString(),
      targetRevisionId: file.revisionId,
      expectedHead: delIds.revisionId,
      revisionId: restoreRevId,
    },
  });

  assert.equal(restored.error, undefined, JSON.stringify(restored.error));
  assert.equal(responseOf(restored.response).status, 200);

  // Verify file is alive again
  const resurrectedFile = await getFile({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(resurrectedFile.error, undefined);
  assert.equal(resurrectedFile.data?.headRevisionId, restoreRevId);
  assert.equal(resurrectedFile.data?.head?.text, originalText);
  assert.equal(resurrectedFile.data?.head?.deleted, false);
});

await test('previewPurge reports affected items and reclaimable bytes', async () => {
  const file = await newFile('purge-preview.md', '# Content To Purge\n');

  const preview = await previewPurge({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: { fileIds: [file.fileId] },
  });

  assert.equal(preview.error, undefined, JSON.stringify(preview.error));
  assert.equal(responseOf(preview.response).status, 200);
  assert.deepEqual(preview.data?.fileIds, [file.fileId]);
  assert.ok(preview.data?.revisionIds.includes(file.revisionId));
  assert.equal(preview.data?.canPurge, true);
  assert.ok((preview.data?.reclaimableBytes ?? 0) > 0);
  assert.deepEqual(preview.data?.blockingReferences, []);
});

await test('non-owner cannot purge files', async () => {
  const file = await newFile('forbidden-purge.md', '# Secret\n');

  const attempt = await purgeFiles({
    headers: browser(memberCookie),
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      fileIds: [file.fileId],
    },
  });

  assert.equal(responseOf(attempt.response).status, 403);
  assert.equal(problemCode(attempt.error), 'forbidden');
});

await test('owner permanently purges file, writes markers, and rejects future writes with 410', async () => {
  const file = await newFile('permanent-purge.md', '# Gone Forever\n');

  const mutationId = randomUUID();
  const purged = await purgeFiles({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      mutationId,
      fileIds: [file.fileId],
    },
  });

  assert.equal(purged.error, undefined, JSON.stringify(purged.error));
  assert.equal(responseOf(purged.response).status, 200);
  assert.deepEqual(purged.data?.purgedFileIds, [file.fileId]);
  assert.ok(purged.data?.purgedRevisionIds.includes(file.revisionId));
  assert.ok((purged.data?.reclaimedBytes ?? 0) > 0);

  // Idempotent retry with same mutationId
  const replay = await purgeFiles({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      mutationId,
      fileIds: [file.fileId],
    },
  });
  assert.equal(replay.error, undefined);
  assert.equal(responseOf(replay.response).status, 200);
  assert.equal(replay.data?.mutationId, mutationId);

  // Reused mutationId with different fileIds fails with 409 mutation_reused
  const reused = await purgeFiles({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: {
      mutationId,
      fileIds: [randomUUID()],
    },
  });
  assert.equal(responseOf(reused.response).status, 409);
  assert.equal(problemCode(reused.error), 'mutation_reused');

  // getFile answers 410 Gone with purged code
  const goneGet = await getFile({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: file.fileId },
  });
  assert.equal(responseOf(goneGet.response).status, 410);
  assert.equal(problemCode(goneGet.error), 'purged');

  // updateFile answers 410 Gone with purged code
  const writeIds = mutationIds();
  const goneUpdate = await updateFile({
    headers: {
      ...browser(ownerCookie),
      'if-match': file.tag,
    },
    path: { workspaceId, fileId: file.fileId },
    body: {
      text: '# Write to Purged\n',
      revisionId: writeIds.revisionId,
      mutationId: writeIds.mutationId,
      deviceId: writeIds.deviceId,
    },
  });
  assert.equal(responseOf(goneUpdate.response).status, 410);
  assert.equal(problemCode(goneUpdate.error), 'purged');
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
