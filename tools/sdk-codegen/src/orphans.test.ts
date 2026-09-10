/** Checks of the orphan component walk over a merged contract document. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoOrphanComponents,
  findOrphanComponents,
  reachableComponents,
} from './orphans.ts';

type Json = Record<string, unknown>;

/** A small document with one operation that uses part of its components. */
function document(): Json {
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
  const components = input.components as Json;
  const schemas = components.schemas as Json;
  schemas.Note = {
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
  const components = input.components as Json;
  delete (components.schemas as Json).Forgotten;
  delete (components.securitySchemes as Json).bearerToken;
  assert.deepEqual(findOrphanComponents(input), []);
  assertNoOrphanComponents(input);
});

await test('a reference that names nothing is a failure', () => {
  const input = document();
  const components = input.components as Json;
  (components.schemas as Json).NoteList = {
    type: 'array',
    items: { $ref: '#/components/schemas/Missing' },
  };
  assert.throws(() => reachableComponents(input), /names nothing/);
});
