/**
 * Remote MCP protocol adapter for notesapp.
 *
 * Implements Streamable HTTP MCP over Fastify, providing authenticated
 * agent tools for workspace/file operations, search, links, history,
 * checkpoints, branches, merge, restore, and sharing.
 */
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  AttachmentStore,
  IdentityStoreHandle,
} from '@notesapp/storage-server';
import type { Action, Actor, ContentRef, SharingStore } from '@notesapp/core';
import {
  commitChangeset,
  createAttachmentChangeset,
  createCheckpoint,
  createFileChangeset,
  createShare,
  getBacklinks,
  isAllowedMediaType,
  listFiles,
  listBranches,
  listHistory,
  listShares,
  markdownContent,
  readFile,
  readHeadForWrite,
  readRevision,
  requestDigest,
  resolveBranches,
  restoreRevision,
  revokeShare,
  searchFiles,
  submitBranch,
  tombstoneContent,
  updateFileChangeset,
  updateShare,
} from '@notesapp/core';
import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import type { AuthInfo, McpHttpHandler } from '@modelcontextprotocol/server';
import { mcpTools } from '@notesapp/api-contract';
import type { ServerConfig } from '../config.ts';
import { hostName } from '../http/host.ts';
import { publicTokenHash } from '../http/sharing.ts';
import { inspectImage } from '../jobs/inspect-image.ts';
import { McpAuthorizationServer } from './authorization.ts';

/** Dependencies for remote MCP server. */
export type McpServerDependencies = {
  readonly config: ServerConfig;
  readonly content: SharingStore;
  readonly attachments: AttachmentStore;
  readonly identity: IdentityStoreHandle;
  readonly authServer: McpAuthorizationServer;
};

/**
 * Normalizes an origin header for localhost or configured allowed origins.
 */
function isAllowedOrigin(
  originHeader: string | undefined,
  config: ServerConfig,
): boolean {
  if (!originHeader) return true;
  try {
    const parsed = new URL(originHeader);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      config.allowedHosts.includes(host)
    );
  } catch {
    return false;
  }
}

/**
 * Converts a Fastify request into a Web Standard Request.
 */
function fastifyToWebRequest(request: FastifyRequest, origin: string): Request {
  const url = new URL(request.url, origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') {
      headers.append(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    }
  }

  const method = request.method.toUpperCase();
  const hasBody =
    method !== 'GET' && method !== 'HEAD' && request.body !== undefined;
  const bodyText = hasBody
    ? typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body)
    : undefined;

  return new Request(url, {
    method,
    headers,
    ...(bodyText !== undefined ? { body: bodyText } : {}),
  });
}

/**
 * Registers all MCP domain tools on an McpServer instance.
 */
function registerAllMcpTools(
  server: McpServer,
  dependencies: McpServerDependencies,
  authInfo: AuthInfo | undefined,
): void {
  const { content, attachments, authServer } = dependencies;

  // Helper to resolve actor and verify authorization for an action
  async function resolveActor(
    workspaceId: string,
    action: Action,
  ): Promise<Actor> {
    return authServer.resolveToolActor(authInfo, workspaceId, action);
  }

  interface McpToolArguments {
    readonly workspaceId: string;
    readonly fileId: string;
    readonly path: string;
    readonly content: string;
    readonly message?: string | null;
    readonly expectedRevisionId?: string;
    readonly query: string;
    readonly limit?: number;
    readonly cursor?: string | null;
    readonly revisionId: string;
    readonly name: string;
    readonly branchName: string;
    readonly baseRevisionId: string;
    readonly winningRevisionId: string;
    readonly expectedHead?: string | null;
    readonly targetRevisionId: string;
    readonly mediaType: string;
    readonly contentBase64: string;
    readonly shareId: string;
    readonly pinnedRevisionId?: string | null;
    readonly expiresAt?: string | null;
  }

  for (const toolDef of mcpTools) {
    const inputSchema = fromJsonSchema(
      toolDef.inputSchema as Record<string, unknown>,
    );

    server.registerTool(
      toolDef.name,
      {
        title: toolDef.title,
        description: toolDef.description,
        inputSchema,
      },
      async (rawArgs: unknown) => {
        const args = (rawArgs ?? {}) as McpToolArguments;
        try {
          switch (toolDef.name) {
            case 'list_workspaces': {
              if (!authInfo) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: 'Unauthenticated' }],
                };
              }
              const extra = authInfo.extra as
                { accountId?: string } | undefined;
              const accountId = extra?.accountId;
              if (!accountId) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: 'Missing account in token' }],
                };
              }
              const memberships =
                await dependencies.identity.memberships(accountId);
              const items = memberships.map((m) => ({
                workspaceId: m.workspaceId,
                role: m.role,
              }));
              return {
                content: [
                  { type: 'text', text: JSON.stringify({ workspaces: items }) },
                ],
              };
            }

            case 'list_files': {
              const actor = await resolveActor(args.workspaceId, 'read');
              const res = await listFiles(content, actor, args.workspaceId, {
                limit: args.limit ?? 100,
                cursor: args.cursor ?? null,
              });
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            case 'get_file': {
              const actor = await resolveActor(args.workspaceId, 'read');
              const res = await readFile(
                content,
                actor,
                args.workspaceId,
                args.fileId,
              );
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              const val = res.value;
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      fileId: val.file.fileId,
                      path: val.file.path,
                      kind: val.file.kind,
                      headRevisionId: val.file.headRevisionId,
                      updatedAt: val.file.updatedAt,
                      file: val.file,
                      head: val.head,
                    }),
                  },
                ],
              };
            }

            case 'create_file': {
              const actor = await resolveActor(args.workspaceId, 'write');
              const fileId = randomUUID();
              const revisionId = randomUUID();
              const mutationId = randomUUID();
              const mdContent = await markdownContent(args.content);
              const changeset = createFileChangeset({
                workspaceId: args.workspaceId,
                fileId,
                revisionId,
                path: args.path,
                content: mdContent,
                message: args.message ?? null,
                ids: {
                  mutationId,
                  deviceId: 'mcp-remote',
                  clientTime: new Date().toISOString(),
                },
              });
              const digest = await requestDigest(
                'createFile',
                { workspaceId: args.workspaceId, fileId, ifMatch: null },
                { path: args.path, text: args.content },
              );
              const commitRes = await commitChangeset(
                content,
                actor,
                changeset,
                digest,
              );
              if (!commitRes.ok) {
                return {
                  isError: true,
                  content: [
                    { type: 'text', text: JSON.stringify(commitRes.error) },
                  ],
                };
              }
              return {
                content: [
                  { type: 'text', text: JSON.stringify(commitRes.value) },
                ],
              };
            }

            case 'update_file': {
              const actor = await resolveActor(args.workspaceId, 'write');
              const head = await readHeadForWrite(
                content,
                actor,
                args.workspaceId,
                args.fileId,
              );
              if (!head.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(head.error) }],
                };
              }
              if (head.value.revisionId !== args.expectedRevisionId) {
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        error: 'conflict',
                        message:
                          'Precondition failed: expected revision does not match current accepted head.',
                        currentHead: head.value.revisionId,
                      }),
                    },
                  ],
                };
              }
              const revisionId = randomUUID();
              const mutationId = randomUUID();
              const path = args.path ?? head.value.path;
              const mdContent =
                typeof args.content === 'string'
                  ? await markdownContent(args.content)
                  : head.value.text !== null
                    ? {
                        kind: 'markdown' as const,
                        digest: head.value.digest,
                        text: head.value.text,
                      }
                    : {
                        kind: 'attachment' as const,
                        digest: head.value.digest,
                        objectId: head.value.objectId ?? '',
                      };
              const changeset = updateFileChangeset({
                workspaceId: args.workspaceId,
                fileId: args.fileId,
                revisionId,
                expectedHead: head.value.revisionId,
                path,
                content: mdContent,
                deleted: false,
                message: args.message ?? null,
                ids: {
                  mutationId,
                  deviceId: 'mcp-remote',
                  clientTime: new Date().toISOString(),
                },
              });
              const digest = await requestDigest(
                'updateFile',
                {
                  workspaceId: args.workspaceId,
                  fileId: args.fileId,
                  ifMatch: [args.expectedRevisionId],
                },
                { path: args.path, text: args.content },
              );
              const commitRes = await commitChangeset(
                content,
                actor,
                changeset,
                digest,
              );
              if (!commitRes.ok) {
                return {
                  isError: true,
                  content: [
                    { type: 'text', text: JSON.stringify(commitRes.error) },
                  ],
                };
              }
              return {
                content: [
                  { type: 'text', text: JSON.stringify(commitRes.value) },
                ],
              };
            }

            case 'delete_file': {
              const actor = await resolveActor(args.workspaceId, 'write');
              const head = await readHeadForWrite(
                content,
                actor,
                args.workspaceId,
                args.fileId,
              );
              if (!head.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(head.error) }],
                };
              }
              if (head.value.revisionId !== args.expectedRevisionId) {
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        error: 'conflict',
                        message:
                          'Precondition failed: expected revision does not match current accepted head.',
                        currentHead: head.value.revisionId,
                      }),
                    },
                  ],
                };
              }
              const revisionId = randomUUID();
              const mutationId = randomUUID();
              const parentContent: ContentRef =
                head.value.text !== null
                  ? {
                      kind: 'markdown',
                      digest: head.value.digest,
                      text: head.value.text,
                    }
                  : {
                      kind: 'attachment',
                      digest: head.value.digest,
                      objectId: head.value.objectId ?? '',
                    };
              const changeset = updateFileChangeset({
                workspaceId: args.workspaceId,
                fileId: args.fileId,
                revisionId,
                expectedHead: head.value.revisionId,
                path: head.value.path,
                content: await tombstoneContent(parentContent),
                deleted: true,
                message: args.message ?? null,
                ids: {
                  mutationId,
                  deviceId: 'mcp-remote',
                  clientTime: new Date().toISOString(),
                },
              });
              const digest = await requestDigest(
                'deleteFile',
                {
                  workspaceId: args.workspaceId,
                  fileId: args.fileId,
                  ifMatch: [args.expectedRevisionId],
                },
                { mutationId },
              );
              const commitRes = await commitChangeset(
                content,
                actor,
                changeset,
                digest,
              );
              if (!commitRes.ok) {
                return {
                  isError: true,
                  content: [
                    { type: 'text', text: JSON.stringify(commitRes.error) },
                  ],
                };
              }
              return {
                content: [
                  { type: 'text', text: JSON.stringify(commitRes.value) },
                ],
              };
            }

            case 'search_files': {
              const actor = await resolveActor(args.workspaceId, 'read');
              const res = await searchFiles(
                content,
                actor,
                args.workspaceId,
                args.query,
                args.limit ?? null,
              );
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ hits: res.value }),
                  },
                ],
              };
            }

            case 'get_backlinks': {
              const actor = await resolveActor(args.workspaceId, 'read');
              const res = await getBacklinks(
                content,
                actor,
                args.workspaceId,
                args.fileId,
                args.limit ?? null,
              );
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ backlinks: res.value }),
                  },
                ],
              };
            }

            case 'list_history': {
              const actor = await resolveActor(args.workspaceId, 'read');
              const res = await listHistory(
                content,
                actor,
                args.workspaceId,
                args.fileId,
                { limit: args.limit ?? 100, cursor: args.cursor ?? null },
              );
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            case 'get_revision': {
              const actor = await resolveActor(args.workspaceId, 'read');
              const res = await readRevision(
                content,
                actor,
                args.workspaceId,
                args.revisionId,
              );
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            case 'create_checkpoint': {
              const actor = await resolveActor(args.workspaceId, 'write');
              const revisionId = randomUUID();
              const mutationId = randomUUID();
              const digest = await requestDigest(
                'createCheckpoint',
                { workspaceId: args.workspaceId, fileId: args.fileId },
                { name: args.name, expectedHead: args.expectedRevisionId },
              );
              const res = await createCheckpoint(
                content,
                actor,
                {
                  workspaceId: args.workspaceId,
                  fileId: args.fileId,
                  revisionId,
                  expectedHead: args.expectedRevisionId ?? '',
                  name: args.name,
                  ids: {
                    mutationId,
                    deviceId: 'mcp-remote',
                    clientTime: new Date().toISOString(),
                  },
                },
                digest,
              );
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            case 'list_branches': {
              const actor = await resolveActor(args.workspaceId, 'read');
              const res = await listBranches(content, actor, args.workspaceId, {
                fileId: args.fileId,
              });
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            case 'submit_branch': {
              const actor = await resolveActor(args.workspaceId, 'write');
              const revisionId = randomUUID();
              const mutationId = randomUUID();
              const conflictGroupId = randomUUID();
              const mdContent = await markdownContent(args.content);
              const digest = await requestDigest(
                'submitBranch',
                { workspaceId: args.workspaceId, conflictGroupId },
                { branchName: args.branchName, fileId: args.fileId },
              );
              const res = await submitBranch(
                content,
                actor,
                {
                  workspaceId: args.workspaceId,
                  mutationId,
                  deviceId: 'mcp-remote',
                  conflictGroupId,
                  expectedHeads: { [args.fileId]: args.baseRevisionId },
                  revisions: [
                    {
                      id: revisionId,
                      fileId: args.fileId,
                      parents: [args.baseRevisionId],
                      path: args.path,
                      deleted: false,
                      content: mdContent,
                      clientTime: new Date().toISOString(),
                      message: args.branchName,
                      restoredFrom: null,
                    },
                  ],
                },
                digest,
              );
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            case 'resolve_branches': {
              const actor = await resolveActor(args.workspaceId, 'write');
              const winningRevResult = await readRevision(
                content,
                actor,
                args.workspaceId,
                args.winningRevisionId,
              );
              if (!winningRevResult.ok) {
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(winningRevResult.error),
                    },
                  ],
                };
              }
              const winning = winningRevResult.value;
              const mutationId = randomUUID();
              const revisionId = randomUUID();
              const digest = await requestDigest(
                'resolveBranches',
                { workspaceId: args.workspaceId },
                {
                  fileId: args.fileId,
                  winningRevisionId: args.winningRevisionId,
                },
              );
              const res = await resolveBranches(
                content,
                actor,
                {
                  workspaceId: args.workspaceId,
                  mutationId,
                  deviceId: 'mcp-remote',
                  clientTime: new Date().toISOString(),
                  resolutions: [
                    {
                      fileId: args.fileId,
                      expectedHead: args.expectedHead ?? null,
                      branchTip: args.winningRevisionId,
                      revisionId,
                      path: winning.path,
                      content:
                        winning.text !== null
                          ? {
                              kind: 'markdown',
                              digest: winning.digest,
                              text: winning.text,
                            }
                          : {
                              kind: 'attachment',
                              digest: winning.digest,
                              objectId: winning.objectId ?? '',
                            },
                      deleted: winning.deleted,
                      message: 'Resolved branch via MCP',
                    },
                  ],
                },
                digest,
              );
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            case 'restore_revision': {
              const actor = await resolveActor(args.workspaceId, 'write');
              const mutationId = randomUUID();
              const revisionId = randomUUID();
              const digest = await requestDigest(
                'restoreRevision',
                { workspaceId: args.workspaceId, fileId: args.fileId },
                {
                  targetRevisionId: args.targetRevisionId,
                  expectedHead: args.expectedRevisionId,
                },
              );
              const res = await restoreRevision(
                content,
                actor,
                {
                  workspaceId: args.workspaceId,
                  fileId: args.fileId,
                  targetRevisionId: args.targetRevisionId,
                  expectedHead: args.expectedRevisionId ?? null,
                  revisionId,
                  ids: {
                    mutationId,
                    deviceId: 'mcp-remote',
                    clientTime: new Date().toISOString(),
                  },
                  message: args.message ?? null,
                },
                digest,
              );
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            case 'upload_attachment': {
              const actor = await resolveActor(args.workspaceId, 'write');
              if (!isAllowedMediaType(args.mediaType)) {
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: `Unsupported media type ${args.mediaType}`,
                    },
                  ],
                };
              }
              const buffer = Buffer.from(args.contentBase64, 'base64');
              if (buffer.length > dependencies.config.limits.bodyBytes) {
                return {
                  isError: true,
                  content: [
                    { type: 'text', text: 'Attachment exceeds size limit.' },
                  ],
                };
              }

              const objectId = randomUUID();
              const tmpPath = attachments.temporaryPath(objectId);
              await mkdir(dirname(tmpPath), { recursive: true });
              await writeFile(tmpPath, buffer);
              const digest = createHash('sha256').update(buffer).digest('hex');

              const inspection = await inspectImage(tmpPath, args.mediaType);
              if (!inspection.ok) {
                await unlink(tmpPath).catch(() => {});
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: `Image inspection failed: ${inspection.reason}`,
                    },
                  ],
                };
              }

              await attachments.saveTemporaryAttachment(
                actor,
                args.workspaceId,
                {
                  id: objectId,
                  digest,
                  size: BigInt(buffer.length),
                  mediaType: inspection.mediaType,
                  width: inspection.width,
                  height: inspection.height,
                },
              );

              const finalization = await attachments.finalizeAttachmentObject(
                actor,
                args.workspaceId,
                objectId,
                digest,
              );
              if (!finalization.ok) {
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: `Attachment finalization failed: ${finalization.error}`,
                    },
                  ],
                };
              }

              const fileId = args.fileId ?? randomUUID();
              const revisionId = randomUUID();
              const mutationId = randomUUID();
              const changeset = createAttachmentChangeset({
                workspaceId: args.workspaceId,
                fileId,
                revisionId,
                path: args.path,
                objectId,
                digest,
                expectedHead: args.expectedRevisionId ?? null,
                message: null,
                ids: {
                  mutationId,
                  deviceId: 'mcp-remote',
                  clientTime: new Date().toISOString(),
                },
              });
              const reqDigest = await requestDigest(
                'finalizeAttachment',
                {
                  workspaceId: args.workspaceId,
                  objectId,
                  ifMatch: args.expectedRevisionId
                    ? [args.expectedRevisionId]
                    : null,
                },
                { fileId, revisionId, path: args.path, digest },
              );
              const commitRes = await commitChangeset(
                content,
                actor,
                changeset,
                reqDigest,
              );
              if (!commitRes.ok) {
                return {
                  isError: true,
                  content: [
                    { type: 'text', text: JSON.stringify(commitRes.error) },
                  ],
                };
              }
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      fileId,
                      revisionId,
                      objectId,
                      digest,
                      byteSize: buffer.length,
                    }),
                  },
                ],
              };
            }

            case 'get_attachment': {
              const actor = await resolveActor(args.workspaceId, 'read');
              const res = await attachments.readAttachmentRevision(
                actor,
                args.workspaceId,
                args.revisionId,
              );
              if (!res) {
                return {
                  isError: true,
                  content: [
                    { type: 'text', text: 'Attachment revision not found.' },
                  ],
                };
              }
              const chunks: Buffer[] = [];
              for await (const chunk of res.stream) {
                chunks.push(
                  Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
                );
              }
              const total = Buffer.concat(chunks);
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      revisionId: args.revisionId,
                      byteSize: Number(res.size),
                      mediaType: res.mediaType,
                      digest: res.digest,
                      contentBase64: total.toString('base64'),
                    }),
                  },
                ],
              };
            }

            case 'create_share': {
              const actor = await resolveActor(args.workspaceId, 'share');
              const token = randomBytes(32).toString('base64url');
              const shareId = randomUUID();
              let pinnedRevisionId = args.pinnedRevisionId;
              if (!pinnedRevisionId) {
                const head = await readHeadForWrite(
                  content,
                  actor,
                  args.workspaceId,
                  args.fileId,
                );
                if (!head.ok) {
                  return {
                    isError: true,
                    content: [
                      { type: 'text', text: JSON.stringify(head.error) },
                    ],
                  };
                }
                pinnedRevisionId = head.value.revisionId;
              }
              const res = await createShare(content, actor, args.workspaceId, {
                id: shareId,
                fileId: args.fileId,
                pinnedRevisionId,
                tokenHash: publicTokenHash(token),
                expiresAt: args.expiresAt ?? null,
              });
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      ...res.value,
                      url: `${dependencies.config.origin}/s/${token}`,
                    }),
                  },
                ],
              };
            }

            case 'update_share': {
              const actor = await resolveActor(args.workspaceId, 'share');
              const res = await updateShare(content, actor, args.workspaceId, {
                shareId: args.shareId,
                fileId: args.fileId,
                pinnedRevisionId: args.pinnedRevisionId ?? '',
                expiresAt: args.expiresAt ?? null,
              });
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            case 'revoke_share': {
              const actor = await resolveActor(args.workspaceId, 'share');
              const res = await revokeShare(
                content,
                actor,
                args.workspaceId,
                args.shareId,
              );
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            case 'list_shares': {
              const actor = await resolveActor(args.workspaceId, 'share');
              const res = await listShares(content, actor, args.workspaceId);
              if (!res.ok) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.value) }],
              };
            }

            default:
              return {
                isError: true,
                content: [{ type: 'text', text: 'Unhandled tool' }],
              };
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: message,
              },
            ],
          };
        }
      },
    );
  }
}

/**
 * Creates the HTTP handler for Streamable HTTP MCP.
 */
export function createMcpHttpHandler(
  dependencies: McpServerDependencies,
): McpHttpHandler {
  return createMcpHandler(
    async (context) => {
      const server = new McpServer({
        name: 'notesapp',
        version: '0.1.0',
      });
      registerAllMcpTools(server, dependencies, context.authInfo);
      return server;
    },
    { legacy: 'stateless' },
  );
}

/**
 * Mounts MCP and OAuth discovery routes on a Fastify application.
 */
export function mountMcpServer(
  app: FastifyInstance,
  dependencies: McpServerDependencies,
): void {
  const { config, authServer } = dependencies;
  const handler = createMcpHttpHandler(dependencies);

  const resourceMetaUrl = `${config.origin}/.well-known/oauth-protected-resource/mcp`;
  const bearerGate = requireBearerAuth({
    verifier: {
      verifyAccessToken: async (token) => {
        return authServer.verifyAccessToken(token);
      },
    },
    resourceMetadataUrl: resourceMetaUrl,
  });

  // RFC 9728 Protected Resource Metadata routes
  const handleProtectedResourceMeta = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const meta = authServer.getProtectedResourceMetadata();
    await reply
      .status(200)
      .header('content-type', 'application/json; charset=utf-8')
      .send(meta);
  };

  app.get('/.well-known/oauth-protected-resource', handleProtectedResourceMeta);
  app.get(
    '/.well-known/oauth-protected-resource/mcp',
    handleProtectedResourceMeta,
  );

  // RFC 8414 Authorization Server Metadata route
  app.get(
    '/.well-known/oauth-authorization-server',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const meta = authServer.getAuthorizationServerMetadata();
      await reply
        .status(200)
        .header('content-type', 'application/json; charset=utf-8')
        .send(meta);
    },
  );

  // Support application/x-www-form-urlencoded for OAuth endpoints
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, body, done) => {
        try {
          const str = typeof body === 'string' ? body : body.toString('utf8');
          const parsed = Object.fromEntries(new URLSearchParams(str));
          done(null, parsed);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );
  }

  // OAuth authorization code flow endpoints
  app.get('/oauth/authorize', async (request, reply) => {
    await authServer.handleAuthorize(request, reply);
  });

  app.post('/oauth/token', async (request, reply) => {
    await authServer.handleToken(request, reply);
  });

  // Streamable HTTP MCP endpoint
  app.all('/mcp', async (request, reply) => {
    // 1. Host header validation
    const host = hostName(request.headers.host);
    if (!config.allowedHosts.includes(host)) {
      await reply.status(400).send({
        error: 'host_not_allowed',
        message: 'This deployment does not serve the requested Host.',
      });
      return;
    }

    // 2. Origin validation
    const originHeader = request.headers.origin;
    if (
      typeof originHeader === 'string' &&
      !isAllowedOrigin(originHeader, config)
    ) {
      await reply.status(403).send({
        error: 'forbidden_origin',
        message: 'Cross-origin request rejected.',
      });
      return;
    }

    // 3. Build Web Standard Request
    const webRequest = fastifyToWebRequest(request, config.origin);

    // 4. Bearer authentication gate
    const authResult = await bearerGate(webRequest);
    if (authResult instanceof Response) {
      reply.status(authResult.status);
      for (const [k, v] of authResult.headers) {
        reply.header(k, v);
      }
      if (authResult.body) {
        return reply.send(
          Readable.fromWeb(
            authResult.body as Parameters<typeof Readable.fromWeb>[0],
          ),
        );
      }
      return reply.send();
    }

    // 5. Invoke MCP handler
    const response = await handler.fetch(webRequest, {
      parsedBody: request.body,
      authInfo: authResult,
    });

    reply.status(response.status);
    for (const [k, v] of response.headers) {
      reply.header(k, v);
    }
    if (response.body) {
      return reply.send(
        Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0],
        ),
      );
    }
    return reply.send();
  });

  app.addHook('onClose', async () => {
    await handler.close();
  });
}
