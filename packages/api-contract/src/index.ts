/**
 * Public entry point of the notesapp HTTP and message contracts.
 *
 * `openapi.yaml` and `asyncapi.yaml` are authoritative. This package exposes
 * the operation registry, the channel registry, and the compiled 2020-12
 * validators that are generated from them.
 */
export type {
  ChannelEntry,
  ChannelId,
  ClientMessageKind,
  MessageDirection,
  ServerMessageKind,
  HttpMethod,
  OperationEntry,
  OperationId,
  SecurityRequirement,
} from './generated/contract.ts';
export type { RequestSlot } from './validators.ts';
export {
  findOperation,
  operations,
  requestValidator,
  responseMediaTypes,
  responseValidator,
} from './operations.ts';
export type {
  ClientMessage,
  MessageRefusal,
  MessageRefusalReason,
} from './messages.ts';
export {
  assertMessageHandlers,
  checkServerMessage,
  findChannel,
  readClientMessage,
} from './messages.ts';
export type { ValidationIssue } from './schema.ts';
export { compileSchema, describeIssues } from './schema.ts';
export type { SchemaObject } from 'ajv';
