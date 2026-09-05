/**
 * Contract checks between the generated client and a real listening server.
 *
 * Every application request goes through a generated operation. A request that
 * no operation can express, such as a forged Host header or an unknown path,
 * uses the framework's in-process `app.inject()` utility. That utility is not
 * a handwritten HTTP call: it builds no URL, serializes no body, and sends no
 * traffic. It is the only supported way to reach the boundary rules that sit
 * outside the contract surface.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { configureClient, getHealth, getReadiness } from '@notesapp/api-client';
import { operations } from '@notesapp/api-contract';
import { createHandlers, loadServerConfig } from '@notesapp/server';
import {
  LogRecorder,
  startTestServer,
  testEnvironment,
} from './support/server.ts';

/** Reads one property of an unknown value without asserting its shape. */
function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/** The HTTP response of a generated call, or a clear test failure. */
function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

/** Checks that a value carries every required problem member. */
function asProblem(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object', 'expected a problem');
  for (const key of ['type', 'title', 'code', 'requestId'])
    assert.equal(typeof readProperty(value, key), 'string', key);
  assert.equal(typeof readProperty(value, 'status'), 'number');
  return Object.fromEntries(Object.entries(value));
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

await test('the server echoes a caller supplied request id', async () => {
  const result = await getHealth({
    headers: { 'x-request-id': 'trace-abc.123' },
  });
  assert.equal(result.error, undefined);
  assert.equal(
    responseOf(result.response).headers.get('x-request-id'),
    'trace-abc.123',
  );
});

await test('an invalid header value is rejected with problem details', async () => {
  const result = await getReadiness({
    headers: { 'x-request-id': 'not a valid id' },
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
  assert.equal(typeof readProperty(issues[0], 'path'), 'string');
  assert.equal(typeof readProperty(issues[0], 'message'), 'string');
  // A malformed correlation id is never echoed back.
  assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
});

await test('an unknown query parameter is rejected', async () => {
  const query: { detail?: 'summary' | 'full' } = {};
  Object.assign(query, { unexpected: 'value' });
  const result = await getReadiness({ query });
  assert.equal(responseOf(result.response).status, 400);
  assert.equal(asProblem(result.error).code, 'invalid_request');
});

await test('an operation without query parameters rejects one', async () => {
  const response = await server.app.inject({
    method: 'GET',
    url: '/api/health?bogus=1',
    headers: { host: '127.0.0.1' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(asProblem(response.json()).code, 'invalid_request');
});

await test('an operation without a request body rejects one', async () => {
  const response = await server.app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { host: '127.0.0.1', 'content-type': 'application/json' },
    payload: '{"unexpected":true}',
  });
  assert.equal(response.statusCode, 400);
  assert.equal(asProblem(response.json()).code, 'invalid_request');
});

await test('a body over the configured limit is rejected', async () => {
  // The configured limit is 1024 bytes. No operation accepts a request body
  // yet, so the boundary rejects the body before the limit can apply. The
  // status that a body over the limit produces is unit tested in
  // `apps/server/src/http/problem.test.ts`, and an operation that accepts a
  // body must declare 413 and 415 or generation fails.
  const response = await server.app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { host: '127.0.0.1', 'content-type': 'application/json' },
    payload: JSON.stringify({ filler: 'x'.repeat(4096) }),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(asProblem(response.json()).code, 'invalid_request');
});

await test('a method that no operation serves answers 404', async () => {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/health',
    headers: { host: '127.0.0.1', 'content-type': 'application/json' },
    payload: '{}',
  });
  assert.equal(response.statusCode, 404);
  assert.equal(asProblem(response.json()).code, 'route_not_found');
});

await test('a forged Host header is rejected', async () => {
  const response = await server.app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { host: 'evil.example' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(asProblem(response.json()).code, 'host_not_allowed');
});

await test('a request that names no served Host is rejected', async () => {
  // The in-process utility always supplies a Host, so an unserved default
  // value is the closest reachable form of an absent Host. The unit tests
  // cover an absent and an empty header value directly.
  const narrow = await startTestServer({
    environment: { NOTESAPP_ALLOWED_HOSTS: '127.0.0.1' },
  });
  try {
    const response = await narrow.app.inject({
      method: 'GET',
      url: '/api/health',
    });
    assert.equal(response.statusCode, 400);
    assert.equal(asProblem(response.json()).code, 'host_not_allowed');
  } finally {
    await narrow.close();
  }
});

await test('a bracketed IPv6 Host with a port is served', async () => {
  const sixth = await startTestServer({
    environment: { NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,[::1]' },
  });
  try {
    const response = await sixth.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: '[::1]:8080' },
    });
    assert.equal(response.statusCode, 200);
  } finally {
    await sixth.close();
  }
});

await test('an unknown path answers with problem details', async () => {
  const response = await server.app.inject({
    method: 'GET',
    url: '/api/missing',
    headers: { host: '127.0.0.1' },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(asProblem(response.json()).code, 'route_not_found');
});

await test('HEAD on a GET route answers without a body', async () => {
  const response = await server.app.inject({
    method: 'HEAD',
    url: '/api/health',
    headers: { host: '127.0.0.1' },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type']?.toString() ?? '', /json/);
  assert.equal(response.body, '');
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

// A degraded readiness probe proves the declared 503 answer.
const degraded = await startTestServer({
  handlers: (config) =>
    createHandlers(config, [
      () =>
        Promise.resolve({
          name: 'database',
          status: 'degraded',
          detail: 'The database connection is not open.',
        }),
    ]),
});
configureClient(degraded.baseUrl, undefined);

await test('a degraded check answers 503 with problem details', async () => {
  const result = await getReadiness();
  assert.equal(result.data, undefined);
  const response = responseOf(result.response);
  assert.equal(response.status, 503);
  assert.match(
    response.headers.get('content-type') ?? '',
    /^application\/problem\+json/,
  );
  const problem = asProblem(result.error);
  assert.equal(problem.code, 'not_ready');
  assert.equal(problem.status, 503);
});

await degraded.close();

// The injected handler answers with a member that the contract forbids.
const recorder = new LogRecorder();
const leaky = await startTestServer({
  environment: { NOTESAPP_LOG_LEVEL: 'error' },
  logStream: recorder,
  handlers: (config) => ({
    ...createHandlers(config),
    getHealth: () =>
      Promise.resolve({
        status: 200,
        mediaType: 'application/json',
        body: { status: 'ok', leaked: 'internal detail' },
      }),
  }),
});
configureClient(leaky.baseUrl, undefined);

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

await test('the rejected response is logged at error level with its id', () => {
  const records = recorder.records().filter((record) => record.level === 50);
  assert.equal(records.length >= 1, true, recorder.lines.join('\n'));
  const record = records[0] ?? {};
  assert.equal(record.operationId, 'getHealth');
  assert.match(String(record.requestId), /^[0-9a-f-]{36}$/);
  // A log record never repeats the rejected content.
  assert.equal(recorder.lines.join('\n').includes('leaked'), false);
});

await leaky.close();

// A token provider must reach the server without appearing in the log.
const audited = new LogRecorder();
const logged = await startTestServer({
  environment: { NOTESAPP_LOG_LEVEL: 'info' },
  logStream: audited,
});
configureClient(logged.baseUrl, () => Promise.resolve('agent-token-value'));

await test('the token provider reaches the server and stays out of the log', async () => {
  const result = await getHealth();
  assert.equal(result.error, undefined);
  assert.ok(audited.lines.length > 0);
  assert.equal(audited.lines.join('\n').includes('agent-token-value'), false);
});

await logged.close();

/**
 * Every answer that a handler can produce outside the contract.
 *
 * A pre-serialized string, a byte buffer, and an undeclared media type all
 * bypass a schema check unless the boundary inspects the answer before the
 * framework writes it, so each one gets its own case.
 */
const leakingAnswers: readonly {
  readonly name: string;
  readonly mediaType: string;
  readonly body: unknown;
}[] = [
  {
    name: 'an undeclared response media type',
    mediaType: 'application/vnd.notes+json',
    body: { status: 'ok', leaked: 'internal detail' },
  },
  {
    name: 'a pre-serialized JSON string',
    mediaType: 'application/json',
    body: JSON.stringify({ status: 'ok', leaked: 'internal detail' }),
  },
  {
    name: 'an HTML string',
    mediaType: 'text/html',
    body: '<p>leaked internal detail</p>',
  },
  {
    name: 'a byte buffer',
    mediaType: 'application/octet-stream',
    body: Buffer.from('leaked internal detail'),
  },
];

for (const answer of leakingAnswers) {
  const audit = new LogRecorder();
  const rejecting = await startTestServer({
    environment: { NOTESAPP_LOG_LEVEL: 'error' },
    logStream: audit,
    handlers: (config) => ({
      ...createHandlers(config),
      getHealth: () =>
        Promise.resolve({
          status: 200,
          mediaType: answer.mediaType,
          body: answer.body,
        }),
    }),
  });
  configureClient(rejecting.baseUrl, undefined);

  await test(`${answer.name} is rejected and logged`, async () => {
    const result = await getHealth();
    assert.equal(result.data, undefined);
    const response = responseOf(result.response);
    assert.equal(response.status, 500);
    assert.match(
      response.headers.get('content-type') ?? '',
      /^application\/problem\+json/,
    );
    const problem = asProblem(result.error);
    assert.equal(problem.code, 'invalid_response');
    assert.equal(JSON.stringify(problem).includes('leaked'), false);
    const errors = audit.records().filter((record) => record.level === 50);
    assert.equal(errors.length >= 1, true, audit.lines.join('\n'));
    assert.equal(errors[0]?.operationId, 'getHealth');
    assert.match(String(errors[0]?.requestId), /^[0-9a-f-]{36}$/);
    // The rejected answer never reaches a log record either.
    assert.equal(audit.lines.join('\n').includes('leaked'), false);
  });

  await rejecting.close();
}
