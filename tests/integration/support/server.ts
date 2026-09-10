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
import type {
  HandlerMap,
  IdentityResolver,
  ProtocolAdapter,
  ProtocolResult,
  ServerConfig,
} from '@notesapp/server';
import {
  authRoutes,
  betterAuthProtocol,
  createAppWithHandlers,
  createHandlers,
  createProblem,
  loadServerConfig,
  problemMediaType,
  UnauthenticatedError,
} from '@notesapp/server';

/**
 * The identity resolver of a test that checks the boundary only.
 *
 * It authenticates nothing, so every guarded operation answers 401. A test
 * that needs real identities supplies the real resolver instead.
 */
export const anonymousIdentity: IdentityResolver = () =>
  Promise.reject(
    new UnauthenticatedError('This test server authenticates nobody.'),
  );

/**
 * The protocol adapter of a test that checks the boundary only.
 *
 * It serves the same exact path list as the real adapter, so registration
 * still proves that every protocol operation has a route, and it answers with
 * a refusal rather than pretending to sign anybody in.
 */
export const stubProtocol: ProtocolAdapter = {
  protocol: betterAuthProtocol,
  routes: authRoutes,
  handle: (request): Promise<ProtocolResult> =>
    Promise.resolve({
      status: 503,
      mediaType: problemMediaType,
      headers: [],
      cookies: [],
      body: createProblem({
        code: 'not_ready',
        status: 503,
        detail: 'This test server serves no identity.',
        instance: request.url.split('?')[0] ?? request.url,
        requestId: request.id,
      }),
      bytes: null,
    }),
};

/** Adds deterministic setup handlers to a server that has no identity store. */
export function completeTestHandlers(handlers: HandlerMap): HandlerMap {
  return {
    ...handlers,
    getSetupStatus: () =>
      Promise.resolve({
        status: 200,
        mediaType: 'application/json',
        body: { initialized: true },
      }),
    createOwner: () =>
      Promise.resolve({
        status: 201,
        mediaType: 'application/json',
        body: { initialized: true },
      }),
  };
}

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
    NOTESAPP_AUTH_DATABASE_URL:
      'postgres://notesapp_auth:notesapp_auth@127.0.0.1:5432/notesapp',
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
  /** Resolver of the operations that declare a security scheme. */
  readonly identity?: IdentityResolver;
  /** Maintained protocol libraries that serve part of the HTTP surface. */
  readonly protocols?: readonly ProtocolAdapter[];
  /** Built browser assets to serve, or null to serve none. */
  readonly webDist?: string | null;
  /** Hook to configure or mount additional adapters on the Fastify instance before listen. */
  readonly onApp?: (
    app: Awaited<ReturnType<typeof createAppWithHandlers>>,
    config: ServerConfig,
  ) => void | Promise<void>;
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
  const handlers = (options.handlers ?? createHandlers)(config);
  const app = await createAppWithHandlers(config, {
    handlers: completeTestHandlers(handlers),
    ...(options.logStream === undefined
      ? {}
      : { logStream: options.logStream }),
    identity: options.identity ?? anonymousIdentity,
    protocols: options.protocols ?? [stubProtocol],
    webDist: options.webDist ?? null,
  });
  if (options.onApp !== undefined) {
    await options.onApp(app, config);
  }
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
