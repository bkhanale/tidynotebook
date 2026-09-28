/** Checks of the contract source layout against a bundled document. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  componentFile,
  findLayoutProblems,
  pathItemFile,
} from './contract-layout.ts';

type Json = Record<string, unknown>;

/** A small bundled document with one path and two components. */
function document(): Json {
  return {
    openapi: '3.1.2',
    paths: {
      '/api/workspaces/{workspaceId}/files': { get: { operationId: 'list' } },
    },
    components: {
      parameters: { WorkspaceId: { name: 'workspaceId', in: 'path' } },
      schemas: { Uuid: { type: 'string' } },
    },
  };
}

/** The files that the fixture document needs. */
function files(): string[] {
  return [
    'paths/api_workspaces_workspaceId_files.yaml',
    'components/parameters/WorkspaceId.yaml',
    'components/schemas/Uuid.yaml',
  ];
}

await test('a path item file is named after its path', () => {
  assert.equal(pathItemFile('/api/health'), 'paths/api_health.yaml');
  assert.equal(
    pathItemFile('/api/workspaces/{workspaceId}/files/{fileId}/history'),
    'paths/api_workspaces_workspaceId_files_fileId_history.yaml',
  );
});

await test('a component file is named after its component', () => {
  assert.equal(
    componentFile('schemas', 'ProblemDetails'),
    'components/schemas/ProblemDetails.yaml',
  );
});

await test('a tree that matches the document has no problem', () => {
  assert.deepEqual(findLayoutProblems(document(), files()), []);
});

await test('a file that nothing reaches is a failure', () => {
  const problems = findLayoutProblems(document(), [
    ...files(),
    'components/schemas/Forgotten.yaml',
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /components\/schemas\/Forgotten\.yaml/);
  assert.match(problems[0] ?? '', /no path and no component reaches this file/);
});

await test('a path file that the root does not list is a failure', () => {
  const problems = findLayoutProblems(document(), [
    ...files(),
    'paths/api_health.yaml',
  ]);
  assert.deepEqual(
    problems.map((problem) => problem.split(':')[0]),
    ['paths/api_health.yaml'],
  );
});

await test('a definition that stays in the root document is a failure', () => {
  const problems = findLayoutProblems(
    document(),
    files().filter((file) => file !== 'components/schemas/Uuid.yaml'),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /the component schemas\/Uuid/);
  assert.match(problems[0] ?? '', /stays in the root document/);
});

await test('a second path brings its own file', () => {
  const input = document();
  const paths = input.paths;
  assert.ok(paths !== null && typeof paths === 'object');
  Object.assign(paths, { '/api/health': { get: { operationId: 'health' } } });
  const problems = findLayoutProblems(input, [
    ...files(),
    'paths/api_health.yaml',
  ]);
  assert.deepEqual(problems, []);
});

await test('one file for two path items is reported once', () => {
  const problems = findLayoutProblems(
    {
      paths: { '/api/{a}/b': {}, '/api/a/b': {} },
      components: {},
    },
    ['paths/api_a_b.yaml'],
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /both need this file/);
});

/** A bundled message contract that shares the Uuid schema file. */
function messages(): Json {
  return {
    asyncapi: '3.0.0',
    channels: { stream: { address: '/api/stream' } },
    components: {
      securitySchemes: { streamCookie: { type: 'httpApiKey' } },
      schemas: { Uuid: { type: 'string' } },
    },
  };
}

/** The files that the fixture documents need together. */
function allFiles(): string[] {
  return [
    ...files(),
    'channels/stream.yaml',
    'components/securitySchemes/streamCookie.yaml',
  ];
}

await test('a schema file serves both contracts', () => {
  assert.deepEqual(findLayoutProblems(document(), allFiles(), messages()), []);
});

await test('a channel keeps its own file', () => {
  const problems = findLayoutProblems(
    document(),
    allFiles().filter((file) => file !== 'channels/stream.yaml'),
    messages(),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /the channel stream stays in the root/);
});

await test('a channel file that no contract lists is a failure', () => {
  const problems = findLayoutProblems(
    document(),
    [...allFiles(), 'channels/forgotten.yaml'],
    messages(),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /channels\/forgotten\.yaml: no path/);
});

await test('a component other than a schema serves one contract only', () => {
  const input = document();
  const components = input.components;
  assert.ok(components !== null && typeof components === 'object');
  Object.assign(components, {
    securitySchemes: { streamCookie: { type: 'apiKey' } },
  });
  const problems = findLayoutProblems(input, allFiles(), messages());
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /both need this file/);
});
