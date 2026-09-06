/**
 * Public entry point of the notesapp HTTP contract.
 *
 * `openapi.yaml` is authoritative. This package exposes the operation registry
 * and the compiled 2020-12 validators that are generated from it.
 */
export type {
  HttpMethod,
  OperationEntry,
  OperationId,
  SecurityRequirement,
} from './generated/contract.ts';
export type { RequestSlot } from './generated/validators.ts';
export {
  findOperation,
  operations,
  requestValidator,
  responseMediaTypes,
  responseValidator,
} from './operations.ts';
export type { ValidationIssue } from './schema.ts';
export { compileSchema, describeIssues } from './schema.ts';
export type { SchemaObject } from 'ajv';
export type { McpToolDefinition, McpToolName } from './mcp-operations.ts';
export { findMcpTool, mcpTools } from './mcp-operations.ts';
