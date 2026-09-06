/**
 * Operation-to-tool map and tool input schemas for Model Context Protocol.
 *
 * Every MCP tool schema derives from the OpenAPI contract operations.
 * Write tools require explicit expected revision identifiers to enforce
 * conditional updates and prevent stale overwrites.
 */
import type { SchemaObject } from 'ajv';
import type { OperationId } from './generated/contract.ts';
import { findOperation } from './operations.ts';

/** All supported MCP tool names. */
export type McpToolName =
  | 'list_workspaces'
  | 'list_files'
  | 'get_file'
  | 'create_file'
  | 'update_file'
  | 'delete_file'
  | 'search_files'
  | 'get_backlinks'
  | 'list_history'
  | 'get_revision'
  | 'create_checkpoint'
  | 'list_branches'
  | 'submit_branch'
  | 'resolve_branches'
  | 'restore_revision'
  | 'upload_attachment'
  | 'get_attachment'
  | 'create_share'
  | 'update_share'
  | 'revoke_share'
  | 'list_shares';

/** Definition of one MCP tool and its mapping to domain operations. */
export type McpToolDefinition = {
  readonly name: McpToolName;
  readonly operationId: OperationId;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: SchemaObject;
};

/** UUID schema helper. */
const uuidSchema: SchemaObject = {
  type: 'string',
  format: 'uuid',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  minLength: 36,
  maxLength: 36,
  description: 'A UUID that identifies one record.',
};

/**
 * Extracts a property schema from an operation request slot.
 */
function extractProperty(
  operationId: OperationId,
  slot: 'params' | 'query' | 'body',
  property: string,
): SchemaObject {
  const op = findOperation(operationId);
  if (!op) {
    throw new Error(`Unknown contract operation ${operationId}`);
  }
  const source = op.request[slot];
  if (source && typeof source === 'object' && 'properties' in source) {
    const props = source.properties as Record<string, SchemaObject> | undefined;
    if (props && property in props && props[property]) {
      return props[property];
    }
  }
  return uuidSchema;
}

/**
 * Definition table for every MCP tool.
 */
export const mcpTools: readonly McpToolDefinition[] = [
  {
    name: 'list_workspaces',
    operationId: 'listWorkspaces',
    title: 'List Workspaces',
    description: 'List all workspaces accessible to the authenticated actor.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_files',
    operationId: 'listFiles',
    title: 'List Files',
    description:
      'List files in a workspace with optional prefix filtering and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('listFiles', 'params', 'workspaceId'),
        prefix: {
          type: 'string',
          description: 'Optional path prefix filter.',
        },
        limit: extractProperty('listFiles', 'query', 'limit'),
        cursor: extractProperty('listFiles', 'query', 'cursor'),
      },
      required: ['workspaceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_file',
    operationId: 'getFile',
    title: 'Get File',
    description: 'Read a file metadata and content by fileId or relative path.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('getFile', 'params', 'workspaceId'),
        fileId: {
          ...uuidSchema,
          description: 'The UUID of the file to read. Specify fileId or path.',
        },
        path: {
          type: 'string',
          description:
            'Relative POSIX path of the file to read. Specify fileId or path.',
        },
      },
      required: ['workspaceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_file',
    operationId: 'createFile',
    title: 'Create File',
    description: 'Create a new markdown note in a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('createFile', 'params', 'workspaceId'),
        path: extractProperty('createFile', 'body', 'path'),
        content: {
          type: 'string',
          maxLength: 1048576,
          description: 'Markdown content of the file.',
        },
        message: {
          type: 'string',
          maxLength: 512,
          description: 'Optional commit or checkpoint message.',
        },
      },
      required: ['workspaceId', 'path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_file',
    operationId: 'updateFile',
    title: 'Update File',
    description:
      'Update the content or path of an existing file. Requires the expected revision ID to prevent stale overwrites.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('updateFile', 'params', 'workspaceId'),
        fileId: extractProperty('updateFile', 'params', 'fileId'),
        expectedRevisionId: {
          ...uuidSchema,
          description:
            'The expected current accepted revision ID of the file before this change.',
        },
        path: extractProperty('updateFile', 'body', 'path'),
        content: {
          type: 'string',
          maxLength: 1048576,
          description: 'New Markdown content for the file.',
        },
        message: {
          type: 'string',
          maxLength: 512,
          description: 'Optional commit or checkpoint message.',
        },
      },
      required: ['workspaceId', 'fileId', 'expectedRevisionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_file',
    operationId: 'deleteFile',
    title: 'Delete File',
    description:
      'Delete a file from a workspace. Requires the expected revision ID to prevent concurrent deletion races.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('deleteFile', 'params', 'workspaceId'),
        fileId: extractProperty('deleteFile', 'params', 'fileId'),
        expectedRevisionId: {
          ...uuidSchema,
          description:
            'The expected current accepted revision ID of the file before deletion.',
        },
        message: {
          type: 'string',
          maxLength: 512,
          description: 'Optional deletion reason or checkpoint message.',
        },
      },
      required: ['workspaceId', 'fileId', 'expectedRevisionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_files',
    operationId: 'searchFiles',
    title: 'Search Files',
    description:
      'Perform text search over note titles and contents in a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('searchFiles', 'params', 'workspaceId'),
        query: extractProperty('searchFiles', 'query', 'query'),
        limit: extractProperty('searchFiles', 'query', 'limit'),
      },
      required: ['workspaceId', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_backlinks',
    operationId: 'getBacklinks',
    title: 'Get Backlinks',
    description:
      'List incoming links from other notes to the target file in a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('getBacklinks', 'params', 'workspaceId'),
        fileId: extractProperty('getBacklinks', 'params', 'fileId'),
        limit: extractProperty('getBacklinks', 'query', 'limit'),
      },
      required: ['workspaceId', 'fileId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_history',
    operationId: 'listHistory',
    title: 'List History',
    description:
      'List the historical revision log of a file in reverse chronological order.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('listHistory', 'params', 'workspaceId'),
        fileId: extractProperty('listHistory', 'params', 'fileId'),
        limit: extractProperty('listHistory', 'query', 'limit'),
        cursor: extractProperty('listHistory', 'query', 'cursor'),
      },
      required: ['workspaceId', 'fileId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_revision',
    operationId: 'getRevision',
    title: 'Get Revision',
    description:
      'Read a specific historical revision of a file by revision ID.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('getRevision', 'params', 'workspaceId'),
        revisionId: extractProperty('getRevision', 'params', 'revisionId'),
      },
      required: ['workspaceId', 'revisionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_checkpoint',
    operationId: 'createCheckpoint',
    title: 'Create Checkpoint',
    description: 'Create a named checkpoint on a file revision.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty(
          'createCheckpoint',
          'params',
          'workspaceId',
        ),
        fileId: extractProperty('createCheckpoint', 'params', 'fileId'),
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 512,
          description: 'The name or label of the checkpoint.',
        },
        expectedRevisionId: {
          ...uuidSchema,
          description:
            'The expected accepted revision id of the file to checkpoint.',
        },
      },
      required: ['workspaceId', 'fileId', 'name', 'expectedRevisionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_branches',
    operationId: 'listBranches',
    title: 'List Branches',
    description:
      'List unmerged conflict branches and alternate revision heads in a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('listBranches', 'params', 'workspaceId'),
        fileId: extractProperty('listBranches', 'query', 'fileId'),
      },
      required: ['workspaceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_branch',
    operationId: 'submitBranch',
    title: 'Submit Branch',
    description:
      'Submit an alternative revision branch without immediately updating the accepted head.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('submitBranch', 'params', 'workspaceId'),
        fileId: {
          ...uuidSchema,
          description: 'The UUID of the file to branch.',
        },
        baseRevisionId: {
          ...uuidSchema,
          description: 'The base revision ID this branch started from.',
        },
        branchName: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          description: 'Name of the branch.',
        },
        path: {
          type: 'string',
          minLength: 1,
          maxLength: 1024,
          description: 'Path of the file on this branch.',
        },
        content: {
          type: 'string',
          maxLength: 1048576,
          description: 'Markdown content for this branch.',
        },
      },
      required: [
        'workspaceId',
        'fileId',
        'baseRevisionId',
        'branchName',
        'path',
        'content',
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'resolve_branches',
    operationId: 'resolveBranches',
    title: 'Resolve Branches',
    description:
      'Resolve and merge conflict branches into a chosen winning revision.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty(
          'resolveBranches',
          'params',
          'workspaceId',
        ),
        fileId: {
          ...uuidSchema,
          description:
            'The UUID of the file whose branches are being resolved.',
        },
        winningRevisionId: {
          ...uuidSchema,
          description: 'The revision ID that wins the conflict resolution.',
        },
        expectedHead: {
          ...uuidSchema,
          description: 'The expected current head revision ID.',
        },
      },
      required: ['workspaceId', 'fileId', 'winningRevisionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'restore_revision',
    operationId: 'restoreRevision',
    title: 'Restore Revision',
    description:
      'Restore a historical revision as the new accepted head of the file. Requires expectedRevisionId.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty(
          'restoreRevision',
          'params',
          'workspaceId',
        ),
        fileId: extractProperty('restoreRevision', 'params', 'fileId'),
        targetRevisionId: {
          ...uuidSchema,
          description: 'The historical revision ID to restore.',
        },
        expectedRevisionId: {
          ...uuidSchema,
          description:
            'The expected current accepted revision ID before restoration.',
        },
        message: {
          type: 'string',
          maxLength: 512,
          description: 'Optional restore reason or message.',
        },
      },
      required: [
        'workspaceId',
        'fileId',
        'targetRevisionId',
        'expectedRevisionId',
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'upload_attachment',
    operationId: 'uploadAttachment',
    title: 'Upload Attachment',
    description:
      'Upload an image or binary attachment to a workspace file using base64 encoding.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty(
          'uploadAttachment',
          'params',
          'workspaceId',
        ),
        fileId: {
          ...uuidSchema,
          description:
            'Optional file UUID if linking to an existing file record.',
        },
        path: {
          type: 'string',
          minLength: 1,
          maxLength: 1024,
          description:
            'Relative POSIX path for the attachment (e.g. assets/diagram.png).',
        },
        mediaType: {
          type: 'string',
          description:
            'MIME media type of the attachment (e.g. image/png, image/jpeg, image/webp).',
        },
        contentBase64: {
          type: 'string',
          description: 'Base64-encoded binary content of the attachment.',
        },
        expectedRevisionId: {
          ...uuidSchema,
          description:
            'Optional expected head revision ID if updating an existing file.',
        },
      },
      required: ['workspaceId', 'path', 'mediaType', 'contentBase64'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_attachment',
    operationId: 'getAttachmentRevision',
    title: 'Get Attachment',
    description: 'Read metadata and base64 content for an attachment revision.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty(
          'getAttachmentRevision',
          'params',
          'workspaceId',
        ),
        revisionId: extractProperty(
          'getAttachmentRevision',
          'params',
          'revisionId',
        ),
      },
      required: ['workspaceId', 'revisionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_share',
    operationId: 'createShare',
    title: 'Create Share',
    description:
      'Create a pinned public share link for a file. If pinnedRevisionId is omitted, pins the current head.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('createShare', 'params', 'workspaceId'),
        fileId: extractProperty('createShare', 'body', 'fileId'),
        pinnedRevisionId: extractProperty(
          'createShare',
          'body',
          'pinnedRevisionId',
        ),
        expiresAt: {
          type: 'string',
          format: 'date-time',
          description: 'Optional expiration timestamp in ISO 8601 format.',
        },
      },
      required: ['workspaceId', 'fileId'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_share',
    operationId: 'updateShare',
    title: 'Update Share',
    description:
      'Update a public share with a newly pinned revision or modified expiration.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('updateShare', 'params', 'workspaceId'),
        shareId: extractProperty('updateShare', 'params', 'shareId'),
        fileId: extractProperty('updateShare', 'body', 'fileId'),
        pinnedRevisionId: extractProperty(
          'updateShare',
          'body',
          'pinnedRevisionId',
        ),
        expiresAt: {
          type: ['string', 'null'],
          format: 'date-time',
          description:
            'Updated expiration timestamp, or null to remove expiry.',
        },
      },
      required: ['workspaceId', 'shareId', 'fileId', 'pinnedRevisionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'revoke_share',
    operationId: 'revokeShare',
    title: 'Revoke Share',
    description: 'Revoke an existing public share link.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('revokeShare', 'params', 'workspaceId'),
        shareId: extractProperty('revokeShare', 'params', 'shareId'),
      },
      required: ['workspaceId', 'shareId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_shares',
    operationId: 'listShares',
    title: 'List Shares',
    description: 'List active public shares in a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: extractProperty('listShares', 'params', 'workspaceId'),
        fileId: {
          ...uuidSchema,
          description: 'Optional file UUID filter.',
        },
      },
      required: ['workspaceId'],
      additionalProperties: false,
    },
  },
];

const toolsByName = new Map<string, McpToolDefinition>(
  mcpTools.map((tool) => [tool.name, tool]),
);

/**
 * Finds an MCP tool definition by tool name.
 */
export function findMcpTool(name: string): McpToolDefinition | undefined {
  return toolsByName.get(name);
}
