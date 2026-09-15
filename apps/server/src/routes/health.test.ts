/**
 * The readiness decision, without a database and without a server.
 *
 * Every input of the decision is injected here: the state that a pooled read
 * returns, the deadline of that read, and the lifecycle state. The pooled read
 * itself runs against real PostgreSQL in
 * `tests/integration/operations.test.ts`, and the four addresses answer
 * through a real listening server in `tests/integration/contract.test.ts`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseProbeResult } from '@notesapp/storage-server';
import { requiredSchemaVersion } from '@notesapp/storage-server';
import { createServiceLifecycle, runningLifecycle } from '../lifecycle.ts';
import type { ProbeRequest, ReadinessCheck, ReadinessProbe } from './health.ts';
import {
  createServiceHandlers,
  databaseProbes,
  evaluateReadiness,
  livenessAnswer,
  readinessAnswer,
  singleFlight,
  withDeadline,
} from './health.ts';
import { problemMediaType } from '../plugins/problem.ts';

/** One readiness request, with the three members that the answer reads. */
function request(url = '/ready', query: unknown = {}): ProbeRequest {
  return { id: 'a-request-id', url, query };
}

/** The stable problem code of an answer, or an empty string. */
function problemCode(body: unknown): string {
  if (body === null || typeof body !== 'object' || !('code' in body)) return '';
  return typeof body.code === 'string' ? body.code : '';
}

/** The check of one name inside a readiness report. */
function checkNamed(body: unknown, name: string): ReadinessCheck {
  assert.ok(body !== null && typeof body === 'object' && 'checks' in body);
  const checks: unknown = body.checks;
  assert.ok(Array.isArray(checks));
  const found = checks.find(
    (check: unknown): check is ReadinessCheck =>
      check !== null &&
      typeof check === 'object' &&
      'name' in check &&
      check.name === name,
  );
  assert.ok(found !== undefined, `the report holds the ${name} check`);
  return found;
}

/** A read that answers the given state and counts how often it ran. */
function countedRead(state: DatabaseProbeResult): {
  read: () => Promise<DatabaseProbeResult>;
  calls: () => number;
} {
  let calls = 0;
  return {
    read: (): Promise<DatabaseProbeResult> => {
      calls += 1;
      return Promise.resolve(state);
    },
    calls: (): number => calls,
  };
}

await test('one function answers both addresses of each question', () => {
  const handlers = createServiceHandlers([], runningLifecycle);
  assert.equal(handlers.getHealth, handlers.getRootHealth);
  assert.equal(handlers.getReadiness, handlers.getRootReadiness);
  assert.notEqual(handlers.getHealth, undefined);
  assert.notEqual(handlers.getReadiness, undefined);
});

await test('liveness reports that the process runs', () => {
  const answer = livenessAnswer();
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { status: 'ok' });
});

await test('a reachable database with the required schema reports ready', async () => {
  const counted = countedRead({
    reachable: true,
    schemaVersion: requiredSchemaVersion,
  });
  const answer = await readinessAnswer(
    databaseProbes(counted.read),
    runningLifecycle,
    request(),
  );
  assert.equal(answer.status, 200);
  assert.equal(checkNamed(answer.body, 'database').status, 'ok');
  assert.equal(checkNamed(answer.body, 'migration').status, 'ok');
  // Both checks read the state of one round trip.
  assert.equal(counted.calls(), 1);
});

await test('a database that does not answer reports degraded', async () => {
  const counted = countedRead({ reachable: false, schemaVersion: null });
  const answer = await readinessAnswer(
    databaseProbes(counted.read),
    runningLifecycle,
    request(),
  );
  assert.equal(answer.status, 503);
  assert.equal(answer.mediaType, problemMediaType);
  assert.equal(problemCode(answer.body), 'not_ready');
});

await test('an incomplete schema is degraded and keeps the database check', async () => {
  const counted = countedRead({
    reachable: true,
    schemaVersion: requiredSchemaVersion - 1,
  });
  const report = await evaluateReadiness(databaseProbes(counted.read), 'full');
  assert.equal(report.status, 'degraded');
  assert.equal(checkNamed(report, 'database').status, 'ok');
  assert.equal(checkNamed(report, 'migration').status, 'degraded');
});

await test('a database that reports no schema version is not migrated', async () => {
  const counted = countedRead({ reachable: true, schemaVersion: null });
  const report = await evaluateReadiness(databaseProbes(counted.read), 'full');
  assert.equal(checkNamed(report, 'database').status, 'ok');
  assert.equal(checkNamed(report, 'migration').status, 'degraded');
});

await test('a read that passes its deadline reports an unreachable database', async () => {
  // This read never answers, so only the deadline can end it.
  const report = await evaluateReadiness(
    databaseProbes(() => new Promise<DatabaseProbeResult>(() => {}), 10),
    'full',
  );
  assert.equal(checkNamed(report, 'database').status, 'degraded');
  assert.equal(checkNamed(report, 'migration').status, 'degraded');
});

await test('a process that drains answers before any probe runs', async () => {
  const lifecycle = createServiceLifecycle();
  const counted = countedRead({
    reachable: true,
    schemaVersion: requiredSchemaVersion,
  });
  const probes = databaseProbes(counted.read);
  lifecycle.beginDrain();
  const answer = await readinessAnswer(probes, lifecycle, request());
  assert.equal(answer.status, 503);
  assert.equal(answer.mediaType, problemMediaType);
  assert.equal(problemCode(answer.body), 'shutting_down');
  // The stop closes the pools, so a draining process reads no database.
  assert.equal(counted.calls(), 0);
});

await test('the drain answer names the address that the caller asked for', async () => {
  const lifecycle = createServiceLifecycle();
  lifecycle.beginDrain();
  for (const url of ['/ready', '/api/ready']) {
    const answer = await readinessAnswer(
      [],
      lifecycle,
      request(`${url}?detail=summary`),
    );
    assert.equal(answer.status, 503);
    assert.equal(problemCode(answer.body), 'shutting_down');
    assert.equal(
      answer.body !== null &&
        typeof answer.body === 'object' &&
        'instance' in answer.body
        ? answer.body.instance
        : '',
      url,
    );
  }
});

await test('a summary report drops the detail of every check', async () => {
  const probe: ReadinessProbe = () =>
    Promise.resolve({ name: 'storage', status: 'ok', detail: 'A detail.' });
  const report = await evaluateReadiness([probe], 'summary');
  assert.equal(report.checks[0]?.detail, undefined);
});

await test('a read that ends answers before its deadline', async () => {
  const answer = await withDeadline(
    () => Promise.resolve('read'),
    50_000,
    'late',
  );
  assert.equal(answer, 'read');
});

await test('a read that fails answers with the late value', async () => {
  const answer = await withDeadline(
    () => Promise.reject(new Error('the read failed')),
    50_000,
    'late',
  );
  assert.equal(answer, 'late');
});

await test('one running read serves every caller that asks while it runs', async () => {
  let calls = 0;
  let release = (): void => {};
  const held = new Promise<void>((accept) => {
    release = accept;
  });
  const shared = singleFlight(async () => {
    calls += 1;
    await held;
    return calls;
  });
  const first = shared();
  const second = shared();
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(calls, 1);
  // The next caller starts a new read, so no answer is held forever.
  assert.equal(await shared(), 2);
});
