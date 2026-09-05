/**
 * Starts a real listening notesapp server for integration tests.
 *
 * The server binds an ephemeral port on the loopback interface, so a test
 * exercises the generated client over real HTTP instead of an injected
 * request object. The instance is also returned, because `app.inject()` is the
 * only way to send a request that no generated operation can express, for
 * example a forged Host header or an unknown path.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { HandlerMap, ServerConfig } from '@notesapp/server';
import {
  createAppWithHandlers,
  createHandlers,
  loadServerConfig,
} from '@notesapp/server';

/** A listening test server and the call that stops it. */
export type TestServer = {
  readonly baseUrl: string;
  readonly config: ServerConfig;
  readonly app: Awaited<ReturnType<typeof createAppWithHandlers>>;
  readonly close: () => Promise<void>;
};

/** Collects the structured log records that a test server writes. */
export class LogRecorder {
  readonly lines: string[] = [];

  write(line: string): void {
    this.lines.push(line);
  }

  /** Parsed records, newest last. */
  records(): Record<string, unknown>[] {
    return this.lines.flatMap((line) => {
      const parsed: unknown = JSON.parse(line);
      return parsed === null || typeof parsed !== 'object'
        ? []
        : [Object.fromEntries(Object.entries(parsed))];
    });
  }
}

/** Environment of a valid test deployment. */
export function testEnvironment(storageRoot: string): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL:
      'postgres://notesapp:notesapp@127.0.0.1:5432/notesapp',
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'test-secret-value-for-integration-checks',
    NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost',
    NOTESAPP_LOG_LEVEL: 'silent',
    NOTESAPP_MAX_BODY_BYTES: '1024',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '5000',
  };
}

/** What a test replaces in the server it starts. */
export type TestServerOptions = {
  /** Builds the handler map, for example to answer outside the contract. */
  readonly handlers?: (config: ServerConfig) => HandlerMap;
  /** Environment overrides, for example a log level a test needs. */
  readonly environment?: Readonly<Record<string, string>>;
  /** Destination of the structured log. */
  readonly logStream?: { write: (line: string) => void };
};

/** Starts the server on an ephemeral loopback port. */
export async function startTestServer(
  options: TestServerOptions = {},
): Promise<TestServer> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-storage-'));
  const config = loadServerConfig({
    ...testEnvironment(storageRoot),
    ...options.environment,
  });
  const app = await createAppWithHandlers(config, {
    handlers: (options.handlers ?? createHandlers)(config),
    ...(options.logStream === undefined
      ? {}
      : { logStream: options.logStream }),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address: string | AddressInfo | null = app.server.address();
  if (address === null || typeof address === 'string') {
    await app.close();
    await rm(storageRoot, { recursive: true, force: true });
    throw new Error('The test server did not bind a TCP port.');
  }
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    config,
    app,
    close: async () => {
      await app.close();
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}
