/** Shared schemas, bounds and safe answers for read tools (0227). */
import { Buffer } from 'node:buffer';
import { compileSchema, type OperationId } from '@notesapp/api-contract';
import type { CallToolResult, Tool } from '@modelcontextprotocol/server';
import type { ContractCall, ContractInput, McpTool } from './registry.ts';

export const maxToolResultBytes = 64 * 1024;
export const notePageUnits = 16 * 1024;
export const defaultToolPageSize = 20;
export const maxToolPageSize = 50;
export const searchMatchLimit = 100;
export const searchWorkspaceLimit = 10;
// Leave room for the complete-result fields of the modern SDK.
const resultMetadataBytes = 256;
export const idSchema = { type: 'string', format: 'uuid' } as const;
export const offsetSchema = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
export const limitSchema = {
  type: 'integer',
  minimum: 1,
  maximum: maxToolPageSize,
  default: defaultToolPageSize,
} as const;
export const cursorSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 4096,
} as const;
export const nextOffsetSchema = {
  anyOf: [offsetSchema, { type: 'null' }],
} as const;
export const nextCursorSchema = {
  anyOf: [cursorSchema, { type: 'null' }],
} as const;
export const noteProperties = {
  workspaceId: idSchema,
  fileId: idSchema,
  path: { type: 'string', minLength: 1, maxLength: 1024 },
  name: { type: 'string', minLength: 1, maxLength: 255 },
} as const;
export const noteRequired = ['workspaceId', 'fileId', 'path', 'name'] as const;

export function objectSchema<T extends Record<string, unknown>>(
  properties: T,
  required: readonly string[] = [],
) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties,
    required: [...required],
  };
}
export function arraySchema<T extends Record<string, unknown>>(items: T) {
  return { type: 'array', maxItems: maxToolPageSize, items };
}
export class ToolFailure extends Error {}
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The contract answer must be an object.');
  return Object.fromEntries(Object.entries(value));
}
export function text(value: Record<string, unknown>, key: string): string {
  const member = value[key];
  if (typeof member !== 'string')
    throw new Error('The contract answer must contain text.');
  return member;
}
export function number(
  value: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const member = value[key];
  return typeof member === 'number' ? member : fallback;
}
export function rows(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const member = value[key];
  if (!Array.isArray(member))
    throw new Error('The contract answer must contain a list.');
  return member.map(record);
}
export function nullableText(
  value: Record<string, unknown>,
  key: string,
): string | null {
  if (value[key] === null) return null;
  return text(value, key);
}
export function noteIdentity(
  workspaceId: string,
  value: Record<string, unknown>,
) {
  const path = text(value, 'path');
  return {
    workspaceId,
    fileId: text(value, 'fileId'),
    path,
    name: path.slice(path.lastIndexOf('/') + 1, -3),
  };
}
export function result(body: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
  };
}
export function fits(body: Record<string, unknown>): boolean {
  return (
    Buffer.byteLength(JSON.stringify(result(body)), 'utf8') <=
    maxToolResultBytes - resultMetadataBytes
  );
}
export function tooLarge(): never {
  throw new ToolFailure(
    'One item is too large to return. Read a smaller part or use the application.',
  );
}
export function offsetPage(
  items: readonly Record<string, unknown>[],
  offset: number,
  limit: number,
  key: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  if (offset > items.length)
    throw new ToolFailure(
      'This position is past the list. Start the list again.',
    );
  const page: Record<string, unknown>[] = [];
  let end = offset;
  while (end < items.length && page.length < limit) {
    const item = items[end];
    if (item === undefined) throw new Error('The list item is missing.');
    const candidate = {
      ...extra,
      [key]: [...page, item],
      nextOffset: end + 1 < items.length ? end + 1 : null,
    };
    if (!fits(candidate)) {
      if (page.length === 0) tooLarge();
      break;
    }
    page.push(item);
    end += 1;
  }
  return { ...extra, [key]: page, nextOffset: end < items.length ? end : null };
}
export async function readContract(
  call: ContractCall,
  id: OperationId,
  input?: ContractInput,
) {
  const answer = await call(id, input);
  if (answer.status !== 200) {
    const message =
      answer.status === 423
        ? 'This account is locked. Open the application to unlock it.'
        : answer.status === 401 || answer.status === 403
          ? 'This account cannot read these notes. Check access in the application.'
          : answer.status === 404 || answer.status === 410
            ? 'The note or workspace is not available. Read the list and try again.'
            : answer.status === 400
              ? 'The request is not valid. Check the input and try again.'
              : 'The server cannot read the notes. Try again later.';
    throw new ToolFailure(message);
  }
  return record(answer.body);
}

/** Schemas are checked here because low-level SDK handlers do not check them. */
export function readTool(
  definition: Tool & { outputSchema: NonNullable<Tool['outputSchema']> },
  operations: readonly OperationId[],
  run: (
    input: Record<string, unknown>,
    call: ContractCall,
  ) => Promise<Record<string, unknown>>,
): McpTool {
  const validateInput = compileSchema<Record<string, unknown>>(
    definition.inputSchema,
  );
  const { $schema, ...outputSchema } = definition.outputSchema;
  const validateOutput = compileSchema<Record<string, unknown>>({
    ...outputSchema,
    ...($schema === undefined ? {} : { $schema }),
  });
  return {
    definition: {
      ...definition,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    scope: 'notes:read',
    operations,
    run: async (input, context) => {
      try {
        if (!validateInput(input))
          throw new ToolFailure(
            'The tool input is not valid. Check the input and try again.',
          );
        const body = await run(input, context.call);
        if (!validateOutput(body))
          throw new Error('The tool answer does not match its schema.');
        if (!fits(body)) tooLarge();
        return result(body);
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                error instanceof ToolFailure
                  ? error.message
                  : 'The server cannot read the notes. Try again later.',
            },
          ],
        };
      }
    },
  };
}
