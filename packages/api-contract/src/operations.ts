/**
 * Operation registry.
 *
 * Every runtime lookup of an operation, of a request schema, and of a response
 * schema goes through this module. The data behind it is generated from
 * `openapi.yaml`, so the contract stays the only source of these shapes.
 */
import type { ValidateFunction } from 'ajv';
import type { OperationEntry, OperationId } from './generated/contract.ts';
import { operationIds, operations } from './generated/contract.ts';
import type { RequestSlot } from './generated/validators.ts';
import {
  requestKey,
  requestValidators,
  responseKey,
  responseValidators,
} from './generated/validators.ts';

const byId = new Map<string, OperationEntry>(
  operations.map((operation) => [operation.id, operation]),
);

/** True when the contract declares this operation id. */
export function isOperationId(id: string): id is OperationId {
  return byId.has(id);
}

/** The operation with this id, or undefined when the contract has no such id. */
export function findOperation(id: string): OperationEntry | undefined {
  return byId.get(id);
}

/** Validator for one request slot, or undefined when the slot carries no data. */
export function requestValidator(
  id: OperationId,
  slot: RequestSlot,
): ValidateFunction | undefined {
  return requestValidators.get(requestKey(id, slot));
}

/**
 * Validator for one declared response. An undefined result means the contract
 * does not declare this status and media type, which is itself a server fault.
 */
export function responseValidator(
  id: OperationId,
  status: number,
  mediaType: string,
): ValidateFunction | undefined {
  return responseValidators.get(responseKey(id, status, mediaType));
}

/** Media types that this operation can return for a status code. */
export function responseMediaTypes(
  id: OperationId,
  status: number,
): readonly string[] {
  return (findOperation(id)?.responses ?? [])
    .filter((response) => response.status === status)
    .map((response) => response.mediaType);
}

export { operationIds, operations };
