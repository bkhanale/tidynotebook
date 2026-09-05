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

/**
 * The validator of the query slot, which converts as well as checks.
 *
 * A query value arrives as text on the wire. OpenAPI parameter serialization
 * describes how that text maps to the declared type, so this is the one place
 * that performs the conversion, and a handler then reads a number where the
 * contract declares one. The body and the header validators never convert: a
 * JSON body already carries typed values, and accepting the string "1" where a
 * number is declared would hide a client defect.
 */
const ajvQuery = new Ajv2020({
  allErrors: false,
  strict: true,
  coerceTypes: true,
});
ajvFormats.default(ajvQuery);

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
    const compiler = slot === 'query' ? ajvQuery : ajv;
    requests.set(requestKey(operation.id, slot), compiler.compile(schema));
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
