/**
 * Contract checks between the generated client and a real listening server.
 *
 * Every request in this file goes through a generated operation. No test
 * builds a URL, a query string, or a request body by hand.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { configureClient, getHealth, getReadiness } from '@notesapp/api-client';
import { operations } from '@notesapp/api-contract';
import { createHandlers, loadServerConfig } from '@notesapp/server';
import { startTestServer, testEnvironment } from './support/server.ts';

/** The HTTP response of a generated call, or a clear test failure. */
function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

/** Checks that a value carries every required problem member. */
function asProblem(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object', 'expected a problem');
  const problem: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  assert.equal(typeof problem.type, 'string');
  assert.equal(typeof problem.title, 'string');
  assert.equal(typeof problem.status, 'number');
  assert.equal(typeof problem.code, 'string');
  assert.equal(typeof problem.requestId, 'string');
  return problem;
}

const server = await startTestServer();
configureClient(server.baseUrl, undefined);

await test('health answers through the generated operation', async () => {
  const result = await getHealth();
  assert.equal(result.error, undefined);
  assert.deepEqual(result.data, { status: 'ok' });
  const response = responseOf(result.response);
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-type') ?? '',
    /^application\/json/,
  );
  assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
});

await test('readiness reports the configuration check', async () => {
  const result = await getReadiness();
  assert.equal(result.error, undefined);
  assert.equal(result.data?.status, 'ok');
  const checks = result.data?.checks ?? [];
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.name, 'configuration');
  assert.equal(checks[0]?.status, 'ok');
  assert.ok((checks[0]?.detail ?? '').length > 0);
});

await test('a summary report omits the detail of every check', async () => {
  const result = await getReadiness({ query: { detail: 'summary' } });
  assert.equal(result.error, undefined);
  assert.equal(result.data?.checks[0]?.detail, undefined);
});

await test('an invalid header value is rejected with problem details', async () => {
  const result = await getReadiness({
    headers: { 'x-request-id': 'not-a-uuid' },
  });
  assert.equal(result.data, undefined);
  const response = responseOf(result.response);
  assert.equal(response.status, 400);
  assert.match(
    response.headers.get('content-type') ?? '',
    /^application\/problem\+json/,
  );
  const problem = asProblem(result.error);
  assert.equal(problem.code, 'invalid_request');
  assert.equal(problem.status, 400);
  const issues: unknown = problem.issues;
  assert.ok(Array.isArray(issues) && issues.length > 0);
});

await test('an unknown query parameter is rejected', async () => {
  const query: { detail?: 'summary' | 'full' } = {};
  Object.assign(query, { unexpected: 'value' });
  const result = await getReadiness({ query });
  assert.equal(responseOf(result.response).status, 400);
  assert.equal(asProblem(result.error).code, 'invalid_request');
});

await test('a cancelled request produces no data', async () => {
  const controller = new AbortController();
  const pending = getHealth({ signal: controller.signal });
  controller.abort();
  const result = await pending;
  assert.equal(result.data, undefined);
  assert.equal(asProblem(result.error).code, 'request_aborted');
  assert.ok(controller.signal.aborted);
});

await test('every operation has exactly one handler and back', () => {
  const config = loadServerConfig(testEnvironment('/tmp'));
  const handlerIds = Object.keys(createHandlers(config)).sort();
  const operationIds = operations.map((operation) => operation.id).sort();
  assert.deepEqual(handlerIds, operationIds);
  assert.equal(new Set(handlerIds).size, handlerIds.length);
  assert.ok(operationIds.length > 0);
});

await server.close();

// The injected handler answers with a member that the contract forbids.
const strictServer = await startTestServer((base) => ({
  ...base,
  getHealth: () =>
    Promise.resolve({
      status: 200,
      mediaType: 'application/json',
      body: { status: 'ok', leaked: 'internal detail' },
    }),
}));
configureClient(strictServer.baseUrl, undefined);

await test('an unexpected response member is rejected by the server', async () => {
  const result = await getHealth();
  assert.equal(result.data, undefined);
  assert.equal(responseOf(result.response).status, 500);
  const problem = asProblem(result.error);
  assert.equal(problem.code, 'invalid_response');
  assert.equal(problem.status, 500);
  // The rejected body must not reach the caller.
  assert.equal(JSON.stringify(problem).includes('leaked'), false);
  assert.match(String(problem.requestId), /^[0-9a-f-]{36}$/);
});

await strictServer.close();
