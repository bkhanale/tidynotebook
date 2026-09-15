/**
 * Checks of the shared definition document and of the validator cache.
 *
 * The generated index states a repeated schema once and points at it. These
 * tests prove that the pointers resolve, that expanding them gives back a
 * self-contained schema, and that the boundary still refuses what it refused
 * when every copy was written out.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';
import {
  operations,
  sharedDefinitions,
  type JsonSchema,
} from './generated/contract.ts';
import { compileCounts } from './validators.ts';
import { describeIssues, responseValidator } from './index.ts';

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * True when a value carries every declared member of an Ajv schema object.
 *
 * `expand` builds a new object out of parsed members, so nothing in its
 * result proves that Ajv can compile it. This guard checks each member that
 * the schema object declares, and the compile calls below take only what it
 * accepted.
 */
function isSchemaObject(value: unknown): value is JsonSchema {
  if (!isRecord(value)) return false;
  for (const key of ['id', '$id', '$schema']) {
    const member: unknown = value[key];
    if (member !== undefined && typeof member !== 'string') return false;
  }
  return value['$async'] !== true;
}

const document: Json = sharedDefinitions;
const declaredDefinitions: unknown = document['$defs'];
if (!isRecord(declaredDefinitions))
  throw new Error('The shared definition document holds no $defs map.');
const definitions: Json = declaredDefinitions;
const pointerPrefix = `${String(document['$id'])}#/$defs/`;

/** Replaces every pointer into the shared document with what it names. */
function expand(value: unknown, seen: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item) => expand(item, seen));
  if (!isRecord(value)) return value;
  const reference = value.$ref;
  if (typeof reference === 'string') {
    assert.ok(
      reference.startsWith(pointerPrefix),
      `the reference ${reference} does not name the shared document`,
    );
    const name = reference.slice(pointerPrefix.length);
    assert.ok(name in definitions, `the definition ${name} does not exist`);
    assert.ok(!seen.includes(name), `the definition ${name} refers to itself`);
    const rest = Object.entries(value).filter(([key]) => key !== '$ref');
    const target = expand(definitions[name], [...seen, name]);
    assert.ok(isRecord(target), `the definition ${name} is not an object`);
    return { ...Object.fromEntries(rest), ...target };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [key, expand(member, seen)]),
  );
}

/** Every schema the index states, one per request slot and per response. */
function everySchema(): JsonSchema[] {
  const schemas: JsonSchema[] = [];
  for (const operation of operations) {
    schemas.push(
      operation.request.params,
      operation.request.query,
      operation.request.headers,
    );
    if (operation.request.body !== null) schemas.push(operation.request.body);
    for (const response of operation.responses) schemas.push(response.schema);
  }
  return schemas;
}

/** One schema with every shared pointer replaced by what it names. */
function expandSchema(schema: JsonSchema): JsonSchema {
  const expanded = expand(schema);
  assert.ok(isSchemaObject(expanded), 'an expanded schema is not compilable');
  return expanded;
}

await test('every shared pointer resolves to a definition', () => {
  const expanded = everySchema().map((schema) => expand(schema));
  assert.equal(expanded.length, everySchema().length);
  assert.ok(expanded.length > 400);
});

await test('an expanded schema holds no reference of its own', () => {
  const text = JSON.stringify(everySchema().map((schema) => expand(schema)));
  assert.equal(text.includes('"$ref"'), false);
});

await test('an expanded schema compiles and behaves like the pointer form', () => {
  const ajv = new Ajv2020({ allErrors: false, strict: true });
  ajvFormats.default(ajv);
  const shared = new Ajv2020({ allErrors: false, strict: true });
  ajvFormats.default(shared);
  shared.addSchema(sharedDefinitions);
  const problem = {
    type: 'about:blank',
    title: 'The request did not match the contract.',
    status: 400,
    detail: 'x',
    instance: '/api/health',
    code: 'invalid_request',
    requestId: '00000000-0000-4000-8000-000000000000',
  };
  const operation = operations.find((entry) => entry.id === 'getHealth');
  assert.ok(operation !== undefined);
  const declared = operation.responses.find(
    (response) => response.mediaType === 'application/problem+json',
  );
  assert.ok(declared !== undefined);
  const pointerForm = shared.compile(declared.schema);
  const expandedForm = ajv.compile(expandSchema(declared.schema));
  assert.equal(pointerForm(problem), true);
  assert.equal(expandedForm(problem), true);
  const broken = { ...problem, status: 'four hundred' };
  assert.equal(pointerForm(broken), false);
  assert.equal(expandedForm(broken), false);
  assert.deepEqual(
    describeIssues(pointerForm.errors),
    describeIssues(expandedForm.errors),
  );
});

await test('a shared definition still refuses an invalid response body', () => {
  const validate = responseValidator(
    'getHealth',
    400,
    'application/problem+json',
  );
  assert.ok(validate !== undefined);
  assert.equal(validate({}), false);
  assert.deepEqual(describeIssues(validate.errors), [
    { path: '/', message: "must have required property 'type'" },
  ]);
});

await test('the shared error schema is written once', () => {
  assert.ok(isRecord(definitions.ProblemDetails));
  const text = JSON.stringify(operations);
  // The index states the pointer, never the schema behind it.
  assert.equal(text.includes('RFC 9457 problem details'), false);
  const pointer = `${pointerPrefix}ProblemDetails`;
  const copies = text.split(JSON.stringify(pointer)).length - 1;
  assert.ok(copies > 200, `${String(copies)} pointers to the error schema`);
});

await test('a schema that many slots share compiles once', () => {
  assert.ok(compileCounts.validators > 400);
  // 434 slots and responses needed 434 compilations before the cache existed.
  assert.ok(
    compileCounts.schemas < compileCounts.validators / 5,
    `${String(compileCounts.schemas)} compilations for ${String(compileCounts.validators)} validators`,
  );
});
