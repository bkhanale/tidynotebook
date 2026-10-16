/** The one tool registry and its contract-only execution port (0227). */
import { findOperation, type OperationId } from '@notesapp/api-contract';
import type { CallToolResult, Tool } from '@modelcontextprotocol/server';
import { readTools } from './read-tools.ts';
import { incrementalTools } from './incremental-tools.ts';
import { writeTools } from './write-tools.ts';

export type ContractInput = {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | boolean>>;
  readonly body?: unknown;
  /** Internal only. The dispatcher maps this observed version to If-Match. */
  readonly expectedVersion?: string;
};
export type ContractAnswer = {
  readonly status: number;
  readonly body: unknown;
};
export type ContractCall = (
  id: OperationId,
  input?: ContractInput,
) => Promise<ContractAnswer>;
/** A tool receives no SDK context, notification, logging or progress function. */
export type ToolContext = {
  readonly call: ContractCall;
  readonly grantId?: string | undefined;
};
export type McpTool = {
  readonly definition: Tool;
  readonly scope: 'notes:read' | 'notes:write';
  readonly operations: readonly OperationId[];
  readonly run: (
    input: unknown,
    context: ToolContext,
  ) => Promise<CallToolResult>;
};

/** The note tools, including the incremental edits of design 027. */
export const mcpTools: readonly McpTool[] = [
  ...readTools,
  ...writeTools,
  ...incrementalTools,
];

export function checkToolRegistry(tools: readonly McpTool[]): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.definition.name))
      throw new Error('A tool name occurs twice.');
    names.add(tool.definition.name);
    if (tool.operations.length === 0)
      throw new Error('A tool names no operation.');
    for (const id of tool.operations) {
      const operation = findOperation(id);
      if (
        operation === undefined ||
        operation.protocol !== null ||
        !operation.security.some(
          (requirement) => 'personalApiKey' in requirement,
        )
      )
        throw new Error('A tool must name an account contract operation.');
      if (
        !['get', 'head'].includes(operation.method) &&
        tool.scope !== 'notes:write'
      )
        throw new Error('A write operation needs the write scope.');
    }
  }
}

/** This is the only context that reaches a registered tool. */
export function runTool(
  tool: McpTool,
  input: unknown,
  call: ContractCall,
  grantId?: string,
): Promise<CallToolResult> {
  return tool.run(input, Object.freeze({ call, grantId }));
}
