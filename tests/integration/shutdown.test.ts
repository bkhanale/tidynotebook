/**
 * The stop of the server is a drain.
 *
 * Issue 20. A stop signal used to close the listener at once, a second signal
 * ended the process in the middle of that close, and the readiness answer
 * stayed at 200 until the listener was gone, so a proxy had no window to send
 * new traffic elsewhere.
 *
 * This file proves the drain twice. The first part runs the real entry point
 * `apps/server/src/main.ts` as its own process against a real database, sends
 * it two real `SIGTERM` signals, and reads the readiness answer and the
 * liveness answer between them. The second part holds one request open across
 * the close of the listener and proves that the answer still arrives.
 *
 * The state machine itself, with its deadline, is proved by the unit test at
 * `apps/server/src/lifecycle.test.ts`.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { configureClient, getHealth, getReadiness } from '@notesapp/api-client';
import {
  createDrain,
  createHandlers,
  createServiceLifecycle,
  type HandlerMap,
  type HandlerResult,
} from '@notesapp/server';
import { createDisposableDatabase } from './support/database.ts';
import { startTestServer } from './support/server.ts';

/** The entry point that a deployment runs. */
const entryPoint = resolve(
  import.meta.dirname,
  '../../apps/server/src/main.ts',
);

/** How long the server waits before it closes the listener, in this test. */
const gracePeriodMs = 5000;

/** Reads one property of an unknown value without asserting its shape. */
function property(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/** The status of an answer, or zero when the request reached nothing. */
function statusOf(answer: { readonly response?: Response }): number {
  return answer.response?.status ?? 0;
}

/** The stable problem code of a refusal, or an empty string. */
function problemCode(error: unknown): string {
  const code = property(error, 'code');
  return typeof code === 'string' ? code : '';
}

/** A port that is free at this moment. */
async function freePort(): Promise<number> {
  return await new Promise((accept, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      if (address === null || typeof address === 'string') {
        socket.close();
        reject(new Error('The test could not reserve a port.'));
        return;
      }
      const port = address.port;
      socket.close(() => accept(port));
    });
  });
}

/**
 * Waits until a condition holds.
 *
 * The test waits for a state and never for a fixed time, so it neither races
 * the server nor slows the suite down.
 */
async function until(
  description: string,
  condition: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((accept) => setTimeout(accept, 20));
  }
  throw new Error(`The server never reached this state: ${description}`);
}

/** One server process, its origin, and everything it wrote for the operator. */
type ServerProcess = {
  readonly child: ChildProcess;
  readonly baseUrl: string;
  readonly output: () => string;
};

/** Starts the real entry point on a free port and waits until it is ready. */
async function startServerProcess(
  environment: Readonly<Record<string, string>>,
): Promise<ServerProcess> {
  // Another test file can take the reserved port between the reservation and
  // the start, so a lost port moves to the next attempt instead of failing.
  for (let attempt = 1; ; attempt += 1) {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${String(port)}`;
    const lines: string[] = [];
    const child = spawn(process.execPath, [entryPoint], {
      env: {
        PATH: process.env['PATH'] ?? '',
        ...environment,
        NOTESAPP_ORIGIN: baseUrl,
        NOTESAPP_HOST: '127.0.0.1',
        NOTESAPP_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => lines.push(chunk));
    child.stderr?.on('data', (chunk: string) => lines.push(chunk));
    const output = (): string => lines.join('');
    configureClient(baseUrl, undefined);
    let ready = false;
    try {
      await until('ready', async () => {
        if (child.exitCode !== null) throw new Error('the server exited');
        const answer = await getReadiness();
        return statusOf(answer) === 200;
      });
      ready = true;
    } catch (error) {
      child.kill('SIGKILL');
      if (attempt >= 5) throw error;
    }
    if (ready) return { child, baseUrl, output };
  }
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-shutdown-test-'));

await test('the server drains on a stop signal and ignores the second one', async (t) => {
  const server = await startServerProcess({
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'shutdown-test-secret-value-0123456789ab',
    NOTESAPP_LOG_LEVEL: 'silent',
    NOTESAPP_MAX_BODY_BYTES: '1048576',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '5000',
    NOTESAPP_SHUTDOWN_GRACE_MS: String(gracePeriodMs),
    NOTESAPP_SHUTDOWN_DEADLINE_MS: '15000',
  });
  t.after(() => {
    if (server.child.exitCode === null) server.child.kill('SIGKILL');
  });
  /** The exit of the process, read once and then asserted at the end. */
  const exited = new Promise<{
    code: number | null;
    signal: string | null;
  }>((accept) => {
    server.child.once('exit', (code, signal) => accept({ code, signal }));
  });

  server.child.kill('SIGTERM');

  // The readiness answer reports the stop while the listener still serves, so
  // a proxy learns to send new traffic elsewhere before the listener closes.
  await until('not ready', async () => {
    const answer = await getReadiness();
    return (
      statusOf(answer) === 503 && problemCode(answer.error) === 'shutting_down'
    );
  });

  // Liveness is a different question. The process runs, so nothing restarts a
  // container that stops on purpose.
  const alive = await getHealth();
  assert.equal(statusOf(alive), 200);
  assert.deepEqual(alive.data, { status: 'ok' });

  // The second signal must not end the process in the middle of the close.
  server.child.kill('SIGTERM');
  assert.equal(server.child.exitCode, null, 'the process is still running');
  const second = await getReadiness();
  assert.equal(statusOf(second), 503, 'the listener still serves');
  assert.equal(problemCode(second.error), 'shutting_down');

  const end = await exited;
  assert.equal(end.code, 0, 'the process stops on its own and reports success');
  assert.equal(end.signal, null, 'nothing had to kill the process');
  const written = server.output();
  assert.match(written, /received SIGTERM again/);
  assert.match(written, /the server stopped/);
  assert.doesNotMatch(written, /did not complete inside the stop deadline/);
});

await test('a request that is open when the listener closes still answers', async () => {
  // The liveness operation is the one unguarded operation that this test can
  // replace, so it stands for any request that takes time to answer.
  let entered = (): void => {};
  const running = new Promise<void>((accept) => {
    entered = accept;
  });
  let complete = (): void => {};
  const held = new Promise<void>((accept) => {
    complete = accept;
  });
  const lifecycle = createServiceLifecycle();
  const server = await startTestServer({
    handlers: (config): HandlerMap => ({
      ...createHandlers(config, undefined, { lifecycle }),
      getHealth: async (): Promise<HandlerResult> => {
        entered();
        await held;
        return {
          status: 200,
          mediaType: 'application/json',
          body: { status: 'ok' },
        };
      },
    }),
  });
  configureClient(server.baseUrl, undefined);

  const inFlight = getHealth();
  await running;

  // No grace period here, so the listener closes while the request is open.
  // The first part of this file proves the grace period itself.
  const steps: string[] = [];
  const drain = createDrain({
    lifecycle,
    close: () => server.app.close(),
    gracePeriodMs: 0,
    deadlineMs: 15_000,
    report: (event) => steps.push(event.step),
    forceExit: () => assert.fail('the stop never reaches its deadline here'),
  });
  const stopped = drain('SIGTERM');
  assert.equal(lifecycle.state(), 'draining');

  complete();
  const answer = await inFlight;
  assert.equal(statusOf(answer), 200, 'the open request still answers');
  await stopped;
  assert.deepEqual(steps, ['started', 'stopped']);
  await server.close();
});

await rm(storageRoot, { recursive: true, force: true });
await database.destroy();
