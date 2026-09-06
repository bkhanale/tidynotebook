/**
 * Integration checks for authenticated MCP access over Streamable HTTP and stdio.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  configureClient,
  createAgentToken,
  getFile,
  listWorkspaces,
  revokeAgentToken,
  signInWithPassword,
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
  McpAuthorizationServer,
  mountMcpServer,
  type ServerConfig,
} from '@notesapp/server';
import {
  openAttachmentStore,
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import { createDisposableDatabase } from './support/database.ts';
import { startTestServer } from './support/server.ts';

function responseOf(response: Response | undefined): Response {
  if (response === undefined) {
    throw new Error('The generated client returned no HTTP response.');
  }
  return response;
}

function cookieHeader(values: readonly string[]): string {
  return values
    .map((entry) => (entry.split(';')[0] ?? '').trim())
    .filter((entry) => entry !== '' && !entry.endsWith('='))
    .join('; ');
}

interface ToolCallResponse {
  readonly content?: readonly { readonly text?: string }[];
  readonly isError?: boolean;
}

interface WorkspacesPayload {
  readonly workspaces: readonly { readonly workspaceId: string }[];
}

interface RevisionsPayload {
  readonly revisions: readonly {
    readonly fileId: string;
    readonly revisionId: string;
  }[];
}

interface FilePayload {
  readonly file: { readonly path: string };
  readonly head: { readonly revisionId: string };
}

interface FilesListPayload {
  readonly files: readonly { readonly fileId: string }[];
}

interface HistoryPayload {
  readonly revisions: readonly unknown[];
}

interface RevisionPayload {
  readonly revisionId: string;
}

interface BranchesPayload {
  readonly branches: readonly { readonly tipRevisionId: string }[];
}

interface AttachmentPayload {
  readonly revisionId: string;
  readonly mediaType: string;
  readonly contentBase64: string;
}

interface SharePayload {
  readonly id: string;
  readonly url: string;
}

interface SearchPayload {
  readonly hits?: readonly unknown[];
}

function toolText(result: unknown): string {
  const envelope = result as ToolCallResponse;
  return envelope.content?.[0]?.text ?? '';
}

function parsePayload<T>(result: unknown): T {
  const rawText = toolText(result);
  return JSON.parse(rawText || '{}') as T;
}

// 1x1 PNG image data base64
const samplePngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-mcp-test-'));

const identity = openIdentityStore(database.runtimeUrl);
const content = openWorkspaceStore(database.runtimeUrl, { poolSize: 4 });
const attachments = openAttachmentStore(database.runtimeUrl, storageRoot, {
  poolSize: 4,
});

function environment(): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'mcp-test-secret-value-0123456789abcdef',
    NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost',
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
const invitations = createInvitationAccounts(config, {
  identity,
  pool: authPool,
  resolveActor: (request) => adapter.resolveActor(request),
});

const authServer = new McpAuthorizationServer({
  config,
  identity,
  resolveSessionActor: (req) => adapter.resolveActor(req).catch(() => null),
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
  onApp: (app) => {
    mountMcpServer(app, {
      config,
      content,
      attachments,
      identity,
      authServer,
    });
  },
});

configureClient(server.baseUrl, undefined);

const ownerEmail = 'mcp-owner@notes.invalid';
const ownerPassword = 'owner-password-123456';
await bootstrapOwner({
  config,
  email: ownerEmail,
  name: 'MCP Owner',
  password: ownerPassword,
});

const ownerSignedIn = await signInWithPassword({
  headers: { origin: 'http://127.0.0.1' },
  body: { email: ownerEmail, password: ownerPassword },
});
const ownerCookie = cookieHeader(
  responseOf(ownerSignedIn.response).headers.getSetCookie(),
);

const workspacesRes = await listWorkspaces({
  headers: { origin: 'http://127.0.0.1', cookie: ownerCookie },
});
const workspaceList = workspacesRes.data?.workspaces ?? [];
assert.ok(workspaceList.length > 0);
const workspaceId = workspaceList[0]?.workspaceId ?? '';

try {
  await test('discovery metadata returns RFC 9728 and RFC 8414 configurations', async () => {
    // RFC 9728 Protected Resource Metadata
    const protectedRes = await server.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource/mcp',
    });
    assert.equal(protectedRes.statusCode, 200);
    const pData = JSON.parse(protectedRes.body) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    assert.equal(pData.resource, 'http://127.0.0.1/mcp');
    assert.deepEqual(pData.authorization_servers, ['http://127.0.0.1']);
    assert.ok(Array.isArray(pData.scopes_supported));

    // RFC 8414 Authorization Server Metadata
    const authRes = await server.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
    });
    assert.equal(authRes.statusCode, 200);
    const aData = JSON.parse(authRes.body) as {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    assert.equal(aData.issuer, 'http://127.0.0.1');
    assert.equal(
      aData.authorization_endpoint,
      'http://127.0.0.1/oauth/authorize',
    );
    assert.equal(aData.token_endpoint, 'http://127.0.0.1/oauth/token');
    assert.deepEqual(aData.code_challenge_methods_supported, ['S256']);
  });

  await test('unauthenticated request is challenged with 401 and resource metadata', async () => {
    const unauthRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });

    assert.equal(unauthRes.statusCode, 401);
    const authHeader = unauthRes.headers['www-authenticate'];
    assert.ok(typeof authHeader === 'string');
    assert.ok(authHeader.startsWith('Bearer'));
    assert.ok(authHeader.includes('resource_metadata='));
  });

  await test('host header allowlist check blocks unserved hostnames', async () => {
    const badHostRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        host: 'evil.invalid',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });

    assert.equal(badHostRes.statusCode, 400);
  });

  await test('OAuth authorization code flow with PKCE issues bound access token', async () => {
    const verifier =
      'mcp-integration-test-verifier-abcdefghijklmnopqrstuvwxyz0123456789';
    const challenge = createHash('sha256')
      .update(verifier, 'utf8')
      .digest('base64url');

    // Step 1: Authorization request with active user cookie
    const authRes = await server.app.inject({
      method: 'GET',
      url: `/oauth/authorize?client_id=test-client&redirect_uri=http://localhost/callback&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&resource=http://127.0.0.1/mcp&scope=notes:read%20notes:write`,
      headers: {
        cookie: ownerCookie,
      },
    });

    assert.equal(authRes.statusCode, 302);
    const location = authRes.headers.location;
    assert.ok(typeof location === 'string');
    const parsedLocation = new URL(location);
    const code = parsedLocation.searchParams.get('code');
    assert.ok(typeof code === 'string' && code.length > 0);

    // Step 2: Code exchange with matching PKCE verifier
    const tokenRes = await server.app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'test-client',
        code,
        redirect_uri: 'http://localhost/callback',
        code_verifier: verifier,
        resource: 'http://127.0.0.1/mcp',
      }).toString(),
    });

    assert.equal(tokenRes.statusCode, 200);
    const tokenData = JSON.parse(tokenRes.body) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    assert.ok(typeof tokenData.access_token === 'string');
    assert.equal(tokenData.token_type, 'Bearer');
    assert.ok(tokenData.expires_in > 0);
  });

  await test('remote MCP over Streamable HTTP supports full content and revision lifecycle', async () => {
    // Create an agent token with full rights
    const tokenRes = await createAgentToken({
      headers: { origin: 'http://127.0.0.1', cookie: ownerCookie },
      body: {
        name: 'remote-agent-token',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        scopes: [
          {
            workspaceId,
            actions: ['read', 'write', 'history', 'share', 'members'],
          },
        ],
      },
    });
    assert.ok(tokenRes.data !== undefined);
    const agentToken = tokenRes.data.secret;
    const agentTokenId = tokenRes.data.token.id;

    const transport = new StreamableHTTPClientTransport(
      new URL('/mcp', server.baseUrl),
      {
        requestInit: {
          headers: {
            authorization: `Bearer ${agentToken}`,
          },
        },
      },
    );

    const client = new Client(
      { name: 'remote-mcp-tester', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    try {
      // 1. List tools
      const toolsResult = await client.listTools();
      assert.equal(toolsResult.tools.length, 21);

      // 2. List workspaces
      const wsResult = await client.callTool({
        name: 'list_workspaces',
        arguments: {},
      });
      assert.equal(wsResult.isError ?? false, false);
      const wsJson = parsePayload<WorkspacesPayload>(wsResult);
      assert.ok(wsJson.workspaces.some((w) => w.workspaceId === workspaceId));

      // 3. Create file
      const createResult = await client.callTool({
        name: 'create_file',
        arguments: {
          workspaceId,
          path: 'notes/architecture.md',
          content: '# System Architecture\n\nNotes application design notes.',
        },
      });
      assert.equal(createResult.isError ?? false, false);
      const createJson = parsePayload<RevisionsPayload>(createResult);
      const fileId = createJson.revisions[0]?.fileId ?? '';
      const rev1 = createJson.revisions[0]?.revisionId ?? '';
      assert.ok(fileId !== '');
      assert.ok(rev1 !== '');

      // 4. Get file
      const getResult = await client.callTool({
        name: 'get_file',
        arguments: {
          workspaceId,
          fileId,
        },
      });
      assert.equal(getResult.isError ?? false, false);
      const getJson = parsePayload<FilePayload>(getResult);
      assert.equal(getJson.file.path, 'notes/architecture.md');
      assert.equal(getJson.head.revisionId, rev1);

      // 5. List files
      const listResult = await client.callTool({
        name: 'list_files',
        arguments: {
          workspaceId,
        },
      });
      assert.equal(listResult.isError ?? false, false);
      const listJson = parsePayload<FilesListPayload>(listResult);
      assert.ok(listJson.files.some((f) => f.fileId === fileId));

      // 6. Update file (success)
      const updateResult = await client.callTool({
        name: 'update_file',
        arguments: {
          workspaceId,
          fileId,
          expectedRevisionId: rev1,
          content: '# System Architecture\n\nUpdated with security section.',
        },
      });
      assert.equal(updateResult.isError ?? false, false);
      const updateJson = parsePayload<RevisionsPayload>(updateResult);
      const rev2 = updateJson.revisions[0]?.revisionId ?? '';
      assert.ok(rev2 !== rev1);

      // 7. Update file with stale expectedRevisionId triggers conflict precondition error
      const staleUpdateResult = await client.callTool({
        name: 'update_file',
        arguments: {
          workspaceId,
          fileId,
          expectedRevisionId: rev1,
          content: '# Stale Overwrite Attempt',
        },
      });
      assert.equal(staleUpdateResult.isError, true);
      const staleText = toolText(staleUpdateResult);
      assert.ok(
        staleText.includes('conflict') || staleText.includes('Precondition'),
      );

      // 8. Create checkpoint
      const checkpointResult = await client.callTool({
        name: 'create_checkpoint',
        arguments: {
          workspaceId,
          fileId,
          name: 'architecture-draft-v1',
          expectedRevisionId: rev2,
        },
      });
      assert.equal(checkpointResult.isError ?? false, false);
      const checkpointJson = parsePayload<RevisionsPayload>(checkpointResult);
      const rev3 = checkpointJson.revisions[0]?.revisionId ?? '';

      // 9. List history
      const historyResult = await client.callTool({
        name: 'list_history',
        arguments: {
          workspaceId,
          fileId,
        },
      });
      assert.equal(historyResult.isError ?? false, false);
      const historyJson = parsePayload<HistoryPayload>(historyResult);
      assert.ok(historyJson.revisions.length >= 3);

      // 10. Get revision
      const revResult = await client.callTool({
        name: 'get_revision',
        arguments: {
          workspaceId,
          revisionId: rev1,
        },
      });
      assert.equal(revResult.isError ?? false, false);
      const revJson = parsePayload<RevisionPayload>(revResult);
      assert.equal(revJson.revisionId, rev1);

      // 11. Restore historical revision
      const restoreResult = await client.callTool({
        name: 'restore_revision',
        arguments: {
          workspaceId,
          fileId,
          targetRevisionId: rev1,
          expectedRevisionId: rev3,
          message: 'Restore v1',
        },
      });
      assert.equal(restoreResult.isError ?? false, false);
      const restoreJson = parsePayload<RevisionsPayload>(restoreResult);
      const rev4 = restoreJson.revisions[0]?.revisionId ?? '';

      // 12. Search files
      const searchResult = await client.callTool({
        name: 'search_files',
        arguments: {
          workspaceId,
          query: 'Architecture',
        },
      });
      assert.equal(searchResult.isError ?? false, false);
      const searchJson = parsePayload<SearchPayload>(searchResult);
      assert.ok((searchJson.hits ?? []).length > 0);

      // 13. Get backlinks
      const backlinkResult = await client.callTool({
        name: 'get_backlinks',
        arguments: {
          workspaceId,
          fileId,
        },
      });
      assert.equal(backlinkResult.isError ?? false, false);

      // 14. Branches: list_branches and submit_branch
      const branchResult = await client.callTool({
        name: 'submit_branch',
        arguments: {
          workspaceId,
          fileId,
          baseRevisionId: rev4,
          branchName: 'experimental-branch',
          path: 'notes/architecture.md',
          content: '# Experimental Branch',
        },
      });
      assert.equal(branchResult.isError ?? false, false);
      const branchJson = parsePayload<BranchesPayload>(branchResult);
      assert.ok(branchJson.branches.length > 0);
      const branchTip = branchJson.branches[0]?.tipRevisionId ?? '';

      const listBranchesResult = await client.callTool({
        name: 'list_branches',
        arguments: {
          workspaceId,
          fileId,
        },
      });
      assert.equal(listBranchesResult.isError ?? false, false);
      const listBranchesJson =
        parsePayload<readonly unknown[]>(listBranchesResult);
      assert.ok(listBranchesJson.length > 0);

      // 15. Resolve branch
      const resolveResult = await client.callTool({
        name: 'resolve_branches',
        arguments: {
          workspaceId,
          fileId,
          winningRevisionId: branchTip,
          expectedHead: rev4,
        },
      });
      assert.equal(resolveResult.isError ?? false, false);
      const resolveJson = parsePayload<RevisionsPayload>(resolveResult);
      const rev5 = resolveJson.revisions[0]?.revisionId ?? '';

      // 16. Upload attachment and get attachment
      const uploadResult = await client.callTool({
        name: 'upload_attachment',
        arguments: {
          workspaceId,
          path: 'assets/diagram.png',
          mediaType: 'image/png',
          contentBase64: samplePngBase64,
        },
      });
      assert.equal(uploadResult.isError ?? false, false);
      const uploadJson = parsePayload<AttachmentPayload>(uploadResult);
      const attachmentRevId = uploadJson.revisionId;
      assert.ok(typeof attachmentRevId === 'string');

      const getAttachmentResult = await client.callTool({
        name: 'get_attachment',
        arguments: {
          workspaceId,
          revisionId: attachmentRevId,
        },
      });
      assert.equal(getAttachmentResult.isError ?? false, false);
      const getAttachmentJson =
        parsePayload<AttachmentPayload>(getAttachmentResult);
      assert.equal(getAttachmentJson.mediaType, 'image/png');
      assert.equal(getAttachmentJson.contentBase64, samplePngBase64);

      // 17. Sharing: create_share, list_shares, update_share, revoke_share
      const createShareResult = await client.callTool({
        name: 'create_share',
        arguments: {
          workspaceId,
          fileId,
          pinnedRevisionId: rev5,
        },
      });
      assert.equal(createShareResult.isError ?? false, false);
      const createShareJson = parsePayload<SharePayload>(createShareResult);
      const shareId = createShareJson.id;
      assert.ok(typeof shareId === 'string');
      assert.ok(createShareJson.url.includes('/s/'));

      const listSharesResult = await client.callTool({
        name: 'list_shares',
        arguments: {
          workspaceId,
        },
      });
      assert.equal(listSharesResult.isError ?? false, false);

      const updateShareResult = await client.callTool({
        name: 'update_share',
        arguments: {
          workspaceId,
          shareId,
          fileId,
          pinnedRevisionId: rev5,
          expiresAt: null,
        },
      });
      assert.equal(updateShareResult.isError ?? false, false);

      const revokeShareResult = await client.callTool({
        name: 'revoke_share',
        arguments: {
          workspaceId,
          shareId,
        },
      });
      assert.equal(revokeShareResult.isError ?? false, false);

      // 18. Delete file
      const deleteResult = await client.callTool({
        name: 'delete_file',
        arguments: {
          workspaceId,
          fileId,
          expectedRevisionId: rev5,
        },
      });
      assert.equal(deleteResult.isError ?? false, false);

      // 19. Token revocation is re-evaluated immediately
      await revokeAgentToken({
        headers: { origin: 'http://127.0.0.1', cookie: ownerCookie },
        path: { tokenId: agentTokenId },
      });

      await assert.rejects(
        async () => {
          await client.callTool({
            name: 'list_files',
            arguments: {
              workspaceId,
            },
          });
        },
        (err: unknown) => {
          const errObj = err as
            | { message?: string; data?: { text?: string; status?: number } }
            | undefined;
          const text = `${errObj?.message ?? ''} ${errObj?.data?.text ?? ''}`;
          return text.includes('revoked') || errObj?.data?.status === 401;
        },
      );
    } finally {
      await client.close();
    }
  });

  await test('local stdio MCP server executes operations backed by HTTP client', async () => {
    // Create an agent token for local stdio MCP
    const stdioTokenRes = await createAgentToken({
      headers: { origin: 'http://127.0.0.1', cookie: ownerCookie },
      body: {
        name: 'stdio-client-token',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        scopes: [
          {
            workspaceId,
            actions: ['read', 'write', 'history', 'share', 'members'],
          },
        ],
      },
    });
    assert.ok(stdioTokenRes.data !== undefined);
    const stdioToken = stdioTokenRes.data.secret;

    const stdioTransport = new StdioClientTransport({
      command: process.execPath,
      args: ['apps/mcp-stdio/dist/main.js'],
      env: {
        ...process.env,
        NOTESAPP_ORIGIN: server.baseUrl,
        NOTESAPP_TOKEN: stdioToken,
      },
    });

    const stdioClient = new Client(
      { name: 'stdio-test-client', version: '1.0.0' },
      { capabilities: {} },
    );
    await stdioClient.connect(stdioTransport);

    try {
      // List tools
      const tools = await stdioClient.listTools();
      assert.equal(tools.tools.length, 21);

      // Create a note via stdio MCP
      const createRes = await stdioClient.callTool({
        name: 'create_file',
        arguments: {
          workspaceId,
          path: 'notes/stdio-note.md',
          content:
            '# Note Created Over Stdio MCP\n\nContent verified through HTTP API.',
        },
      });
      assert.equal(createRes.isError ?? false, false);
      const createJson = parsePayload<RevisionsPayload>(createRes);
      const stdioFileId = createJson.revisions[0]?.fileId ?? '';
      const stdioRev1 = createJson.revisions[0]?.revisionId ?? '';

      // Verify domain state through HTTP API directly
      const httpFileRes = await getFile({
        headers: { origin: 'http://127.0.0.1', cookie: ownerCookie },
        path: { workspaceId, fileId: stdioFileId },
      });
      assert.equal(httpFileRes.data?.fileId, stdioFileId);
      assert.equal(httpFileRes.data?.path, 'notes/stdio-note.md');
      assert.equal(httpFileRes.data?.headRevisionId, stdioRev1);

      // Read back through stdio MCP
      const getRes = await stdioClient.callTool({
        name: 'get_file',
        arguments: {
          workspaceId,
          fileId: stdioFileId,
        },
      });
      assert.equal(getRes.isError ?? false, false);
      const getJson = parsePayload<FilePayload>(getRes);
      assert.equal(getJson.file.path, 'notes/stdio-note.md');

      // Update via stdio MCP
      const updateRes = await stdioClient.callTool({
        name: 'update_file',
        arguments: {
          workspaceId,
          fileId: stdioFileId,
          expectedRevisionId: stdioRev1,
          content: '# Note Created Over Stdio MCP\n\nUpdated through stdio.',
        },
      });
      assert.equal(updateRes.isError ?? false, false);
      const updateJson = parsePayload<RevisionsPayload>(updateRes);
      const stdioRev2 = updateJson.revisions[0]?.revisionId ?? '';

      // Stale write check via stdio MCP
      const staleRes = await stdioClient.callTool({
        name: 'update_file',
        arguments: {
          workspaceId,
          fileId: stdioFileId,
          expectedRevisionId: stdioRev1,
          content: '# Stale edit',
        },
      });
      assert.equal(staleRes.isError, true);

      // Search via stdio MCP
      const searchRes = await stdioClient.callTool({
        name: 'search_files',
        arguments: {
          workspaceId,
          query: 'Stdio',
        },
      });
      assert.equal(searchRes.isError ?? false, false);
      const searchJson = parsePayload<SearchPayload>(searchRes);
      assert.ok((searchJson.hits ?? []).length > 0);

      // Delete via stdio MCP
      const deleteRes = await stdioClient.callTool({
        name: 'delete_file',
        arguments: {
          workspaceId,
          fileId: stdioFileId,
          expectedRevisionId: stdioRev2,
        },
      });
      assert.equal(deleteRes.isError ?? false, false);
    } finally {
      await stdioClient.close();
    }
  });
} finally {
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
}
