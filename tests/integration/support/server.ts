/**
 * Starts a real listening notesapp server for integration tests.
 *
 * The server binds an ephemeral port on the loopback interface, so a test
 * exercises the generated client over real HTTP instead of an injected
 * request object.
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
  readonly close: () => Promise<void>;
};

/** Environment of a valid test deployment. */
export function testEnvironment(storageRoot: string): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL:
      'postgres://notesapp:notesapp@127.0.0.1:5432/notesapp',
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'test-secret-value-for-integration-checks',
    NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost',
    NOTESAPP_MAX_BODY_BYTES: '1048576',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '5000',
  };
}

/**
 * Starts the server. A caller can replace the handler map to exercise a
 * boundary rule, for example a handler that answers outside the contract.
 */
export async function startTestServer(
  overrides?: (base: HandlerMap) => HandlerMap,
): Promise<TestServer> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-storage-'));
  const config = loadServerConfig(testEnvironment(storageRoot));
  const base = createHandlers(config);
  const app = await createAppWithHandlers(
    config,
    overrides === undefined ? base : overrides(base),
  );
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
    close: async () => {
      await app.close();
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}
