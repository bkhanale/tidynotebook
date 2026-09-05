/*
 * Generated from packages/api-contract/openapi.yaml by tools/sdk-codegen.
 * Do not edit by hand. Run `pnpm generate` after a contract change.
 */

import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';

import type { JsonSchema, OperationId } from './contract.ts';
import { operations } from './contract.ts';

export type RequestSlot = 'params' | 'query' | 'headers' | 'body';

const ajv = new Ajv2020({ allErrors: false, strict: true });
// Ajv formats ships CommonJS. Node binds a default import to `module.exports`,
// so the plugin function is reached through its `default` member.
ajvFormats.default(ajv);

/** Key of a request validator. */
export function requestKey(id: OperationId, slot: RequestSlot): string {
  return `${id}:${slot}`;
}

/** Key of a response validator. */
export function responseKey(
  id: OperationId,
  status: number,
  mediaType: string,
): string {
  return `${id}:${String(status)}:${mediaType}`;
}

const requests = new Map<string, ValidateFunction>();
const responses = new Map<string, ValidateFunction>();

for (const operation of operations) {
  const slots: readonly (readonly [RequestSlot, JsonSchema | null])[] = [
    ['params', operation.request.params],
    ['query', operation.request.query],
    ['headers', operation.request.headers],
    ['body', operation.request.body],
  ];
  for (const [slot, schema] of slots) {
    if (schema === null) continue;
    requests.set(requestKey(operation.id, slot), ajv.compile(schema));
  }
  for (const response of operation.responses) {
    responses.set(
      responseKey(operation.id, response.status, response.mediaType),
      ajv.compile(response.schema),
    );
  }
}

/** Compiled request validators, keyed by requestKey. */
export const requestValidators: ReadonlyMap<string, ValidateFunction> = requests;

/** Compiled response validators, keyed by responseKey. */
export const responseValidators: ReadonlyMap<string, ValidateFunction> =
  responses;
