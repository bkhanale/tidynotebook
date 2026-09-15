/**
 * Shares the repeated schemas of the runtime operation index.
 *
 * The index is built from a dereferenced document, so every operation carries
 * its own copy of every schema it uses. One shared error schema was written
 * 259 times, which was 77 percent of the generated file. This module writes
 * each repeated schema once into a shared definition document and replaces
 * every copy with a `$ref` into it.
 *
 * The rewrite changes no validation outcome. A `$ref` alone in a schema object
 * is the whole schema, so the pointed definition applies exactly where the
 * copy applied. `packages/api-contract/src/validators.ts` registers the
 * definition document with each Ajv instance, so the pointers resolve.
 */
import type { ContractIndex, OperationEntry } from './contract-index.ts';

/**
 * Address of the shared definition document.
 *
 * A `$ref` needs an absolute address, because a slot schema is compiled on its
 * own and has no base of its own. The reserved `.invalid` domain of RFC 2606
 * can never resolve, which states in the value itself that nothing fetches it.
 */
export const definitionsId = 'https://notesapp.invalid/contract-definitions';

/**
 * Smallest schema that is worth a definition, in JSON characters.
 *
 * A short schema such as `{"type":"string"}` costs less as a copy than as a
 * pointer plus a definition entry, and a file of hundreds of one line
 * definitions is harder to read than the copies it replaces.
 */
const minimumSharedLength = 120;

type Json = Record<string, unknown>;

/** Keywords whose value is one schema. */
const schemaKeywords = new Set([
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

/** Keywords whose value is a list of schemas. */
const schemaListKeywords = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

/** Keywords whose value maps names to schemas. */
const schemaMapKeywords = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * One schema read back from the text that `JSON.stringify` wrote for it.
 *
 * Every text here comes from a schema of the bundled contract, so a value
 * that is not a record means that the text and the schema no longer agree.
 * Generation then stops rather than emitting a definition of an unknown
 * shape.
 */
function parseSchema(text: string): Json {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed))
    throw new Error('A shared definition body is not a schema object.');
  return parsed;
}

/**
 * Calls `visit` on this schema and on every schema inside it.
 *
 * Only the JSON Schema keywords above hold schemas. Every other member is
 * data: `enum`, `const`, `examples`, and `default` can all hold an object that
 * is not a schema, and rewriting one would change what the schema accepts.
 * The walk is pre-order and follows object member order, so the names it
 * assigns are stable.
 */
function visitSchemas(node: unknown, visit: (schema: Json) => void): void {
  if (!isRecord(node)) return;
  visit(node);
  for (const [keyword, value] of Object.entries(node)) {
    if (schemaKeywords.has(keyword)) visitSchemas(value, visit);
    else if (schemaListKeywords.has(keyword) && Array.isArray(value))
      for (const item of value) visitSchemas(item, visit);
    else if (schemaMapKeywords.has(keyword) && isRecord(value))
      for (const item of Object.values(value)) visitSchemas(item, visit);
  }
}

/** The root schemas of one operation, without the `$schema` member. */
function rootSchemas(operation: OperationEntry): Json[] {
  const roots: (Json | null)[] = [
    operation.request.params,
    operation.request.query,
    operation.request.headers,
    operation.request.body,
    ...operation.responses.map((response) => response.schema),
  ];
  return roots.filter((root): root is Json => root !== null).map(withoutMeta);
}

/**
 * The schema without its `$schema` member.
 *
 * A root schema declares the dialect. That member is valid at the root of a
 * schema resource only, so a definition body must not carry it, and the root
 * keeps it next to the `$ref` that replaces the rest.
 */
function withoutMeta(schema: Json): Json {
  const { $schema, ...rest } = schema;
  void $schema;
  return rest;
}

/** Rewrites the members of one schema, leaving the schema itself in place. */
function rewriteMembers(node: Json, names: ReadonlyMap<string, string>): Json {
  const result: Json = {};
  for (const [keyword, value] of Object.entries(node)) {
    if (schemaKeywords.has(keyword)) result[keyword] = rewrite(value, names);
    else if (schemaListKeywords.has(keyword) && Array.isArray(value))
      result[keyword] = value.map((item) => rewrite(item, names));
    else if (schemaMapKeywords.has(keyword) && isRecord(value))
      result[keyword] = Object.fromEntries(
        Object.entries(value).map(([name, item]) => [
          name,
          rewrite(item, names),
        ]),
      );
    else result[keyword] = value;
  }
  return result;
}

/** Replaces a shared schema with its pointer, or rewrites its members. */
function rewrite(node: unknown, names: ReadonlyMap<string, string>): unknown {
  if (!isRecord(node)) return node;
  const name = names.get(JSON.stringify(node));
  if (name !== undefined) return { $ref: `${definitionsId}#/$defs/${name}` };
  return rewriteMembers(node, names);
}

/** Rewrites one root schema and puts its dialect member back in front. */
function rewriteRoot(schema: Json, names: ReadonlyMap<string, string>): Json {
  const dialect = schema.$schema;
  const body = rewrite(withoutMeta(schema), names);
  if (!isRecord(body)) throw new Error('A root schema must stay an object.');
  return dialect === undefined ? body : { $schema: dialect, ...body };
}

/** A contract index whose schemas point into one shared definition document. */
export type SharedContract = {
  readonly index: ContractIndex;
  /** Body of the `$defs` member of the shared definition document. */
  readonly definitions: Json;
};

/**
 * Names each repeated schema and rewrites every copy into a pointer.
 *
 * `componentSchemas` is `components.schemas` of the same dereferenced
 * document. A repeated schema that is one of those components takes that
 * component name, so the generated file and an Ajv error path both name the
 * schema the contract author wrote. A repeated schema that is not a whole
 * component gets a numbered name.
 */
export function shareDefinitions(
  index: ContractIndex,
  componentSchemas: Json,
): SharedContract {
  const componentNames = new Map<string, string>();
  for (const [name, schema] of Object.entries(componentSchemas))
    if (isRecord(schema)) componentNames.set(JSON.stringify(schema), name);

  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const operation of index.operations)
    for (const root of rootSchemas(operation))
      visitSchemas(root, (schema) => {
        const text = JSON.stringify(schema);
        const seen = counts.get(text);
        if (seen === undefined) order.push(text);
        counts.set(text, (seen ?? 0) + 1);
      });

  const names = new Map<string, string>();
  const taken = new Set<string>();
  let numbered = 0;
  for (const text of order) {
    if ((counts.get(text) ?? 0) < 2) continue;
    if (text.length < minimumSharedLength) continue;
    let name = componentNames.get(text);
    if (name === undefined || taken.has(name)) {
      numbered += 1;
      name = `Shared${String(numbered)}`;
    }
    taken.add(name);
    names.set(text, name);
  }

  const definitions: Json = {};
  const bodies = [...names].map(([text, name]) => [name, text] as const);
  for (const [name, text] of bodies.sort(([left], [right]) =>
    left < right ? -1 : 1,
  ))
    definitions[name] = rewriteMembers(parseSchema(text), names);

  return {
    index: {
      version: index.version,
      operations: index.operations.map((operation) => ({
        ...operation,
        request: {
          params: rewriteRoot(operation.request.params, names),
          query: rewriteRoot(operation.request.query, names),
          headers: rewriteRoot(operation.request.headers, names),
          body:
            operation.request.body === null
              ? null
              : rewriteRoot(operation.request.body, names),
          bodyMediaType: operation.request.bodyMediaType,
        },
        responses: operation.responses.map((response) => ({
          ...response,
          schema: rewriteRoot(response.schema, names),
        })),
      })),
    },
    definitions,
  };
}
