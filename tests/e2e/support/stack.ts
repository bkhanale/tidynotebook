import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import {
  bootstrapOwner,
  createApp,
  createPublicationCleanup,
  loadServerConfig,
} from '@notesapp/server';
import { openWorkspaceStore } from '@notesapp/storage-server';
import {
  createDisposableDatabase,
  openSession,
} from '../../integration/support/database.ts';

export type E2EStack = {
  readonly baseUrl: string;
  readonly email: string;
  readonly password: string;
  /**
   * Runs the retention job of published links with a cutoff of its own.
   *
   * `apps/server` runs this job every hour with the instant of the run. A
   * journey that needs a link or a reading ticket to be past its life cannot
   * wait for that hour and must not sleep, so it asks for the run that the
   * hour after would perform. The job is the product's own, not a route and
   * not a hook for tests: only the cutoff comes from the journey.
   */
  readonly runPublicationRetention: (cutoff: Date) => Promise<void>;
  /**
   * The workspaces of this installation, newest last, as the database holds
   * them.
   *
   * A journey that switches workspace has to prove what the server holds and
   * not only what the screen shows. The read goes to the database of this
   * stack, like `runPublicationRetention` above, so no journey writes an HTTP
   * call of its own.
   */
  readonly readWorkspaces: () => Promise<
    readonly { readonly workspaceId: string; readonly name: string }[]
  >;
  /** The live note paths of one workspace, as the database holds them. */
  readonly readNotePaths: (workspaceId: string) => Promise<readonly string[]>;
};

/** One independently owned application stack for a browser journey. */
export type RunningE2EStack = E2EStack & {
  readonly close: () => Promise<void>;
};

type WorkerFixtures = {
  readonly stack: E2EStack;
};

type TestFixtures = {
  readonly checkedPage: Page;
};

async function freePort(): Promise<number> {
  return await new Promise((accept, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('The E2E server could not reserve a port.'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error !== undefined) reject(error);
        else accept(port);
      });
    });
  });
}

/**
 * How many ports one stack tries.
 *
 * A reserved port is free at the moment of the reservation, and the socket
 * closes again so the application can take it. Parallel workers reserve at
 * the same time, so the operating system can hand the same port to two of
 * them. The loser takes the next port instead of failing the whole file.
 */
const portAttempts = 8;

/** Whether the operating system refused a port because it is taken. */
function isPortTaken(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'EADDRINUSE' || error.code === 'EACCES')
  );
}

async function waitUntilReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/ready`);
      if (response.ok) return;
    } catch {
      // The server can still be between listen and readiness.
    }
    await new Promise((accept) => setTimeout(accept, 50));
  }
  throw new Error('The E2E application did not become ready.');
}

/** Starts an isolated stack with a new database and storage directory. */
export async function startE2EStack(
  browserName: string,
  initialize = true,
): Promise<RunningE2EStack> {
  const database = await createDisposableDatabase();
  const storageRoot = await mkdtemp(
    resolve(tmpdir(), `notesapp-e2e-${browserName}-`),
  );
  const email = 'owner@e2e.notes.invalid';
  const password = 'e2e-owner-password';
  const configure = (baseUrl: string): ReturnType<typeof loadServerConfig> => {
    // This stack has no proxy, so the public origin and the listening socket
    // name the same port. The origin of a stack that binds no port names none
    // either. See
    // [decision 0042](../../../docs/decisions/0042-the-listening-socket-is-not-the-public-origin.md).
    const port = new URL(baseUrl).port;
    return loadServerConfig({
      NOTESAPP_ORIGIN: baseUrl,
      ...(port === '' ? {} : { NOTESAPP_PORT: port }),
      NOTESAPP_DATABASE_URL: database.runtimeUrl,
      NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
      NOTESAPP_STORAGE_ROOT: storageRoot,
      NOTESAPP_AUTH_SECRET: 'e2e-session-secret-with-at-least-32-characters',
      NOTESAPP_LOG_LEVEL: 'silent',
      NOTESAPP_MAX_BODY_BYTES: String(25 * 1024 * 1024),
      NOTESAPP_MAX_HEADER_BYTES: '16384',
      NOTESAPP_REQUEST_TIMEOUT_MS: '10000',
      NOTESAPP_UPLOAD_IDLE_TIMEOUT_MS: '5000',
    });
  };
  let app: Awaited<ReturnType<typeof createApp>> | null = null;
  try {
    // The owner is written to the database, so it survives a port that the
    // application has to give up below.
    if (initialize) {
      await bootstrapOwner({
        config: configure('http://127.0.0.1'),
        email,
        name: 'E2E Owner',
        password,
      });
    }
    for (let attempt = 1; ; attempt += 1) {
      const port = await freePort();
      const baseUrl = `http://127.0.0.1:${String(port)}`;
      app = await createApp(configure(baseUrl), {
        webDist: resolve(import.meta.dirname, '../../../apps/web/dist/web'),
      });
      try {
        await app.listen({ host: '127.0.0.1', port });
      } catch (error: unknown) {
        await app.close();
        app = null;
        if (attempt >= portAttempts || !isPortTaken(error)) throw error;
        continue;
      }
      await waitUntilReady(baseUrl);
      const started = app;
      return {
        baseUrl,
        email,
        password,
        readWorkspaces: async (): Promise<
          readonly { readonly workspaceId: string; readonly name: string }[]
        > => {
          const session = await openSession(database.migrationUrl);
          try {
            const rows = await session.query<{ id: string; name: string }>(
              'select id, name from workspaces order by name',
            );
            return rows.map((row) => ({
              workspaceId: row.id,
              name: row.name,
            }));
          } finally {
            await session.close();
          }
        },
        readNotePaths: async (
          workspaceId: string,
        ): Promise<readonly string[]> => {
          const session = await openSession(database.migrationUrl);
          try {
            // `live_paths` holds the current path of every note that is not
            // deleted, which is what the note list of the workspace shows.
            const rows = await session.query<{ path: string }>(
              'select path from live_paths where workspace_id = $1 order by path',
              [workspaceId],
            );
            return rows.map((row) => row.path);
          } finally {
            await session.close();
          }
        },
        runPublicationRetention: async (cutoff: Date): Promise<void> => {
          // One connection, opened for the run and closed again, so a stack
          // that never asks for the job holds no pool for it.
          const store = openWorkspaceStore(database.runtimeUrl, {
            poolSize: 1,
          });
          try {
            await createPublicationCleanup(store)(cutoff);
          } finally {
            await store.close();
          }
        },
        close: async (): Promise<void> => {
          await started.close();
          await database.destroy();
          await rm(storageRoot, { recursive: true, force: true });
        },
      };
    }
  } catch (error: unknown) {
    await app?.close();
    await database.destroy();
    await rm(storageRoot, { recursive: true, force: true });
    throw error;
  }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  stack: [
    async ({ browserName }, use) => {
      const running = await startE2EStack(browserName);
      try {
        await use(running);
      } finally {
        await running.close();
      }
    },
    { scope: 'worker' },
  ],
  checkedPage: async ({ page, browserName }, use) => {
    const errors: string[] = [];
    const isExpectedWebKitCancellation = (text: string): boolean =>
      browserName === 'webkit' &&
      text.includes('/api/') &&
      text.endsWith('due to access control checks.');
    page.on('pageerror', (error) => {
      if (!isExpectedWebKitCancellation(error.message))
        errors.push(error.message);
    });
    page.on('console', (message) => {
      const text = message.text();
      if (
        message.type() === 'error' &&
        !text.startsWith('Failed to load resource:') &&
        !isExpectedWebKitCancellation(text)
      )
        errors.push(text);
    });
    await use(page);
    expect(errors, 'The browser emitted unexpected errors.').toEqual([]);
  },
});

export { expect };
