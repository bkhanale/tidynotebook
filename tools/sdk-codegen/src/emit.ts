import { definitionsId, type SharedContract } from './definitions.ts';

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
export function emitContractModule(shared: SharedContract): string {
  const { definitions, index } = shared;
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
  /**
   * The protocol library that serves this operation, or null.
   *
   * A protocol operation is implemented by a maintained library rather than by
   * a contract handler. The server registers it through that adapter's exact
   * path list and leaves it out of the one-handler-per-operation check.
   */
  readonly protocol: string | null;
  /** Alternative security requirements. An empty list means public. */
  readonly security: readonly SecurityRequirement[];
  readonly parameters: readonly ParameterSerialization[];
  readonly request: RequestSchemas;
  readonly responses: readonly ResponseSchema[];
  /**
   * Statuses that the operation declares without a response body, such as a
   * 304. The boundary permits an empty answer only for these.
   */
  readonly noContent: readonly number[];
};

/** Version of the contract document that produced this index. */
export const contractVersion = '${index.version}';

/**
 * The schemas that more than one operation slot states.
 *
 * Every schema below is written once here and pointed at from each slot that
 * uses it, so the contract is not copied per operation. A consumer that
 * compiles a slot schema must register this document first; see
 * \`packages/api-contract/src/validators.ts\`.
 */
export const sharedDefinitions: JsonSchema = ${literal({ $id: definitionsId, $defs: definitions })};

export const operations: readonly OperationEntry[] = ${literal(index.operations)};
`;
}
