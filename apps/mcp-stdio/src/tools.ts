/**
 * Local MCP stdio tool registrations backed by the generated HTTP client.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/server';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import { mcpTools } from '@notesapp/api-contract';
import {
  createCheckpoint,
  createFile,
  deleteFile,
  finalizeAttachment,
  getAttachmentRevision,
  getBacklinks,
  getFile,
  listFiles,
  listHistory,
  listWorkspaces,
  getRevision,
  restoreRevision,
  searchFiles,
  updateFile,
  uploadAttachment,
} from '@notesapp/api-client';

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
  readonly targetRevisionId: string;
  readonly mediaType: string;
  readonly contentBase64: string;
}

/**
 * Registers all domain tools on the local stdio MCP server instance.
 */
export function registerStdioTools(server: McpServer): void {
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
              const res = await listWorkspaces();
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.data) }],
              };
            }

            case 'list_files': {
              const res = await listFiles({
                path: { workspaceId: args.workspaceId },
                query: {
                  ...(args.limit !== undefined ? { limit: args.limit } : {}),
                  ...(args.cursor ? { cursor: args.cursor } : {}),
                },
              });
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.data) }],
              };
            }

            case 'get_file': {
              const fileId = args.fileId;
              if (!fileId) {
                return {
                  isError: true,
                  content: [
                    { type: 'text', text: 'fileId is required for get_file.' },
                  ],
                };
              }
              const res = await getFile({
                path: { workspaceId: args.workspaceId, fileId },
              });
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              const data = res.data;
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      ...data,
                      file: data
                        ? {
                            fileId: data.fileId,
                            path: data.path,
                            kind: data.kind,
                            headRevisionId: data.headRevisionId,
                            updatedAt: data.updatedAt,
                          }
                        : undefined,
                    }),
                  },
                ],
              };
            }

            case 'create_file': {
              const res = await createFile({
                path: { workspaceId: args.workspaceId },
                body: {
                  fileId: randomUUID(),
                  revisionId: randomUUID(),
                  mutationId: randomUUID(),
                  deviceId: 'mcp-stdio',
                  path: args.path,
                  text: args.content,
                  message: args.message ?? null,
                },
              });
              if (res.error) {
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
                      revision: res.data?.revision,
                      accepted: res.data?.accepted,
                      revisions: res.data?.accepted?.revisions ?? [],
                    }),
                  },
                ],
              };
            }

            case 'update_file': {
              const res = await updateFile({
                path: { workspaceId: args.workspaceId, fileId: args.fileId },
                headers: {
                  'if-match': `"${args.expectedRevisionId}"`,
                },
                body: {
                  revisionId: randomUUID(),
                  mutationId: randomUUID(),
                  deviceId: 'mcp-stdio',
                  ...(args.path !== undefined ? { path: args.path } : {}),
                  ...(args.content !== undefined ? { text: args.content } : {}),
                  message: args.message ?? null,
                },
              });
              if (res.error) {
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
                      revision: res.data?.revision,
                      accepted: res.data?.accepted,
                      revisions: res.data?.accepted?.revisions ?? [],
                    }),
                  },
                ],
              };
            }

            case 'delete_file': {
              const res = await deleteFile({
                path: { workspaceId: args.workspaceId, fileId: args.fileId },
                headers: {
                  'if-match': `"${args.expectedRevisionId}"`,
                },
                body: {
                  revisionId: randomUUID(),
                  mutationId: randomUUID(),
                  deviceId: 'mcp-stdio',
                  message: args.message ?? null,
                },
              });
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.data) }],
              };
            }

            case 'search_files': {
              const res = await searchFiles({
                path: { workspaceId: args.workspaceId },
                query: {
                  query: args.query,
                  ...(args.limit !== undefined ? { limit: args.limit } : {}),
                },
              });
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.data) }],
              };
            }

            case 'get_backlinks': {
              const res = await getBacklinks({
                path: { workspaceId: args.workspaceId, fileId: args.fileId },
                query: {
                  ...(args.limit !== undefined ? { limit: args.limit } : {}),
                },
              });
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.data) }],
              };
            }

            case 'list_history': {
              const res = await listHistory({
                path: { workspaceId: args.workspaceId, fileId: args.fileId },
                query: {
                  ...(args.limit !== undefined ? { limit: args.limit } : {}),
                  ...(args.cursor ? { cursor: args.cursor } : {}),
                },
              });
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.data) }],
              };
            }

            case 'get_revision': {
              const res = await getRevision({
                path: {
                  workspaceId: args.workspaceId,
                  revisionId: args.revisionId,
                },
              });
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.data) }],
              };
            }

            case 'create_checkpoint': {
              const res = await createCheckpoint({
                path: { workspaceId: args.workspaceId, fileId: args.fileId },
                headers:
                  args.expectedRevisionId !== undefined
                    ? { 'if-match': `"${args.expectedRevisionId}"` }
                    : {},
                body: {
                  name: args.name,
                  mutationId: randomUUID(),
                  deviceId: 'mcp-stdio',
                  clientTime: new Date().toISOString(),
                },
              });
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.data) }],
              };
            }

            case 'restore_revision': {
              const res = await restoreRevision({
                path: { workspaceId: args.workspaceId, fileId: args.fileId },
                body: {
                  targetRevisionId: args.targetRevisionId,
                  expectedHead: args.expectedRevisionId ?? null,
                  revisionId: randomUUID(),
                  mutationId: randomUUID(),
                  deviceId: 'mcp-stdio',
                  clientTime: new Date().toISOString(),
                  ...(args.message ? { message: args.message } : {}),
                },
              });
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.data) }],
              };
            }

            case 'upload_attachment': {
              const buffer = Buffer.from(args.contentBase64, 'base64');
              const blob = new Blob([buffer], { type: args.mediaType });
              const filename = args.path.split('/').pop() || 'upload.bin';
              const fileObj = new File([blob], filename, {
                type: args.mediaType,
              });

              const uploadRes = await uploadAttachment({
                path: { workspaceId: args.workspaceId },
                body: { file: fileObj },
              });
              if (uploadRes.error) {
                return {
                  isError: true,
                  content: [
                    { type: 'text', text: JSON.stringify(uploadRes.error) },
                  ],
                };
              }
              const uploaded = uploadRes.data as unknown as {
                objectId: string;
                digest: string;
                size: number;
                mediaType:
                  'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
              };

              const finalizeRes = await finalizeAttachment({
                path: {
                  workspaceId: args.workspaceId,
                  objectId: uploaded.objectId,
                },
                headers: {
                  ...(args.expectedRevisionId
                    ? { 'if-match': `"${args.expectedRevisionId}"` }
                    : {}),
                },
                body: {
                  fileId: args.fileId ?? randomUUID(),
                  revisionId: randomUUID(),
                  mutationId: randomUUID(),
                  deviceId: 'mcp-stdio',
                  path: args.path,
                  digest: uploaded.digest,
                },
              });
              if (finalizeRes.error) {
                return {
                  isError: true,
                  content: [
                    { type: 'text', text: JSON.stringify(finalizeRes.error) },
                  ],
                };
              }
              return {
                content: [
                  { type: 'text', text: JSON.stringify(finalizeRes.data) },
                ],
              };
            }

            case 'get_attachment': {
              const res = await getAttachmentRevision({
                path: {
                  workspaceId: args.workspaceId,
                  revisionId: args.revisionId,
                },
              });
              if (res.error) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(res.error) }],
                };
              }
              return {
                content: [{ type: 'text', text: JSON.stringify(res.data) }],
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
            content: [{ type: 'text', text: message }],
          };
        }
      },
    );
  }
}
