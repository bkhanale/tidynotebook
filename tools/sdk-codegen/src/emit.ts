import type { ContractIndex } from './contract-index.ts';

const header = (source: string) =>
  [
    '/*',
    ` * Generated from ${source} by tools/sdk-codegen.`,
    ' * Do not edit by hand. Run `pnpm generate` after a contract change.',
    ' */',
    '',
  ].join('\n');

const literal = (value: unknown) => JSON.stringify(value, null, 2);

/** Runtime operation index. Pure data plus the types that describe it. */
export function emitContractModule(index: ContractIndex): string {
  const ids = index.operations.map((operation) => operation.id);
  return `${header('packages/api-contract/openapi.yaml')}
import type { SchemaObject } from 'ajv';

/** Every operation id declared by the contract. */
export type OperationId =
${ids.map((id) => `  | '${id}'`).join('\n')};

export type HttpMethod =
  | 'get'
  | 'put'
  | 'post'
  | 'delete'
  | 'options'
  | 'head'
  | 'patch'
  | 'trace';

/** A JSON Schema 2020-12 object that Ajv can compile. */
export type JsonSchema = SchemaObject;

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

/** Explicit serialization of one parameter, copied from the contract. */
export type ParameterSerialization = {
  readonly name: string;
  readonly location: ParameterLocation;
  readonly required: boolean;
  readonly style: string;
  readonly explode: boolean;
};

/**
 * One schema for each request slot. The path, query, and header schemas always
 * exist. A closed empty object schema means the operation accepts no member of
 * that kind, so an unknown one is rejected. A null body means the operation
 * accepts no request body at all.
 */
export type RequestSchemas = {
  readonly params: JsonSchema;
  readonly query: JsonSchema;
  readonly headers: JsonSchema;
  readonly body: JsonSchema | null;
  readonly bodyMediaType: string | null;
};

/** One security requirement: scheme name to the scopes it must carry. */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

export type ResponseSchema = {
  readonly status: number;
  readonly mediaType: string;
  readonly schema: JsonSchema;
};

export type OperationEntry = {
  readonly id: OperationId;
  readonly method: HttpMethod;
  readonly path: string;
  /** Alternative security requirements. An empty list means public. */
  readonly security: readonly SecurityRequirement[];
  readonly parameters: readonly ParameterSerialization[];
  readonly request: RequestSchemas;
  readonly responses: readonly ResponseSchema[];
};

/** Version of the contract document that produced this index. */
export const contractVersion = '${index.version}';

export const operations: readonly OperationEntry[] = ${literal(index.operations)};
`;
}

/**
 * Ajv 2020-12 validators for every request slot and every declared response.
 *
 * Ajv compiles each schema once when this module loads. Standalone code output
 * was not used because the emitted module is JavaScript, and this package
 * compiles and publishes TypeScript sources through its declaration build.
 */
export function emitValidatorModule(): string {
  return `${header('packages/api-contract/openapi.yaml')}
import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';

import type { JsonSchema, OperationId } from './contract.ts';
import { operations } from './contract.ts';

export type RequestSlot = 'params' | 'query' | 'headers' | 'body';

const ajv = new Ajv2020({ allErrors: false, strict: true });
// Ajv formats ships CommonJS. Node binds a default import to \`module.exports\`,
// so the plugin function is reached through its \`default\` member.
ajvFormats.default(ajv);

/** Key of a request validator. */
export function requestKey(id: OperationId, slot: RequestSlot): string {
  return \`\${id}:\${slot}\`;
}

/** Key of a response validator. */
export function responseKey(
  id: OperationId,
  status: number,
  mediaType: string,
): string {
  return \`\${id}:\${String(status)}:\${mediaType}\`;
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
`;
}
