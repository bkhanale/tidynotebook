import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { bootstrapOwner, createApp, loadServerConfig } from '@notesapp/server';
import { createDisposableDatabase } from '../../integration/support/database.ts';

export type E2EStack = {
  readonly baseUrl: string;
  readonly email: string;
  readonly password: string;
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
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const email = 'owner@e2e.notes.invalid';
  const password = 'e2e-owner-password';
  const config = loadServerConfig({
    NOTESAPP_ORIGIN: baseUrl,
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'e2e-session-secret-with-at-least-32-characters',
    NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost',
    NOTESAPP_LOG_LEVEL: 'silent',
    NOTESAPP_MAX_BODY_BYTES: String(25 * 1024 * 1024),
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '10000',
  });
  let app: Awaited<ReturnType<typeof createApp>> | null = null;
  try {
    if (initialize)
      await bootstrapOwner({ config, email, name: 'E2E Owner', password });
    app = await createApp(config, {
      webDist: resolve(import.meta.dirname, '../../../apps/web/dist/web'),
    });
    await app.listen({ host: '127.0.0.1', port });
    await waitUntilReady(baseUrl);
    return {
      baseUrl,
      email,
      password,
      close: async (): Promise<void> => {
        await app?.close();
        await database.destroy();
        await rm(storageRoot, { recursive: true, force: true });
      },
    };
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
