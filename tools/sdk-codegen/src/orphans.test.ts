/** Checks of the orphan component walk over a merged contract document. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoOrphanComponents,
  findOrphanComponents,
  reachableComponents,
} from './orphans.ts';

type Json = Record<string, unknown>;

/** The component groups of the fixture, named so a test can edit one. */
type FixtureComponents = {
  securitySchemes: Json;
  parameters: Json;
  responses: Json;
  schemas: Json;
};

/**
 * The fixture document, with its groups declared.
 *
 * The walk under test takes a plain record, but a test that adds or removes
 * one component has to reach a group. The fixture states its own shape, so
 * the edits below need no claim about it.
 */
type FixtureDocument = {
  openapi: string;
  security: readonly Json[];
  paths: Json;
  components: FixtureComponents;
};

/** A small document with one operation that uses part of its components. */
function document(): FixtureDocument {
  return {
    openapi: '3.1.1',
    security: [{ sessionCookie: [] }],
    paths: {
      '/api/notes': {
        get: {
          operationId: 'listNotes',
          parameters: [{ $ref: '#/components/parameters/PageLimit' }],
          responses: {
            '200': { $ref: '#/components/responses/Notes' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'session' },
        bearerToken: { type: 'http', scheme: 'bearer' },
      },
      parameters: {
        PageLimit: {
          name: 'limit',
          in: 'query',
          schema: { $ref: '#/components/schemas/Limit' },
        },
      },
      responses: {
        Notes: {
          description: 'Every note.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NoteList' },
            },
          },
        },
      },
      schemas: {
        Limit: { type: 'integer', minimum: 1 },
        NoteList: {
          type: 'array',
          items: { $ref: '#/components/schemas/Note' },
        },
        Note: { type: 'object', properties: { id: { type: 'string' } } },
        Forgotten: { type: 'object' },
      },
    },
  };
}

await test('the walk reaches a component through a chain of references', () => {
  const reachable = reachableComponents(document());
  for (const pointer of [
    '#/components/parameters/PageLimit',
    '#/components/responses/Notes',
    '#/components/schemas/Limit',
    '#/components/schemas/NoteList',
    '#/components/schemas/Note',
  ])
    assert.ok(reachable.has(pointer), pointer);
});

await test('a security scheme is reached by its name', () => {
  const reachable = reachableComponents(document());
  assert.ok(reachable.has('#/components/securitySchemes/sessionCookie'));
});

await test('the walk reports every component nothing reaches', () => {
  assert.deepEqual(findOrphanComponents(document()), [
    '#/components/schemas/Forgotten',
    '#/components/securitySchemes/bearerToken',
  ]);
});

await test('a schema property called security is not read as a scheme', () => {
  const input = document();
  const schemas = input.components.schemas;
  schemas['Note'] = {
    type: 'object',
    properties: { security: { $ref: '#/components/schemas/Limit' } },
  };
  const reachable = reachableComponents(input);
  assert.ok(reachable.has('#/components/schemas/Limit'));
  assert.equal(reachable.has('#/components/securitySchemes/security'), false);
});

await test('generation stops and names the unreachable component', () => {
  assert.throws(
    () => {
      assertNoOrphanComponents(document());
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /no\noperation reaches/);
      assert.match(error.message, /#\/components\/schemas\/Forgotten/);
      return true;
    },
  );
});

await test('a document whose components are all used passes', () => {
  const input = document();
  delete input.components.schemas['Forgotten'];
  delete input.components.securitySchemes['bearerToken'];
  assert.deepEqual(findOrphanComponents(input), []);
  assertNoOrphanComponents(input);
});

await test('a reference that names nothing is a failure', () => {
  const input = document();
  input.components.schemas['NoteList'] = {
    type: 'array',
    items: { $ref: '#/components/schemas/Missing' },
  };
  assert.throws(() => reachableComponents(input), /names nothing/);
});

/** A message contract in bundled form whose one message sends a Note. */
function messages(): {
  operations: Json;
  components: { schemas: Json };
} {
  return {
    operations: {
      sendNote: {
        action: 'send',
        channel: {
          address: '/api/stream',
          messages: {
            note: {
              name: 'note',
              payload: { $ref: '#/components/schemas/Forgotten' },
            },
          },
        },
      },
    },
    components: { schemas: { Forgotten: { type: 'object' } } },
  };
}

await test('a schema that only a message reaches is in use', () => {
  assert.deepEqual(findOrphanComponents(document(), messages()), [
    '#/components/securitySchemes/bearerToken',
  ]);
});

await test('a schema that neither contract reaches is still an orphan', () => {
  const stream = messages();
  const operation = stream.operations.sendNote;
  assert.ok(operation !== null && typeof operation === 'object');
  Object.assign(operation, {
    channel: { address: '/api/stream', messages: {} },
  });
  assert.deepEqual(findOrphanComponents(document(), stream), [
    '#/components/schemas/Forgotten',
    '#/components/securitySchemes/bearerToken',
    'asyncapi.yaml #/components/schemas/Forgotten',
  ]);
});
