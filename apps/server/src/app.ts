/**
 * Server composition.
 *
 * `createApp` builds a Fastify instance that serves exactly the operations in
 * the contract. It adds the checks that every request passes through: a
 * request id, the Host allowlist, the configured body limit, contract request
 * validation, contract response validation, and problem details for every
 * failure.
 */
import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OperationId } from '@notesapp/api-contract';
import { findOperation } from '@notesapp/api-contract';
import type { ServerConfig } from './config.ts';
import type { ServiceLifecycle } from './lifecycle.ts';
import { createHandlers } from './routes/handlers.ts';
import {
  configurationProbe,
  databaseProbes,
  storageProbe,
  type ReadinessProbe,
} from './routes/health.ts';
import type {
  HandlerMap,
  IdentityResolver,
  ProtocolAdapter,
} from './plugins/register.ts';
import { registerOperations } from './plugins/register.ts';
import type { AuthLogRecord } from './auth/better-auth.ts';
import {
  createAuth,
  createAuthPool,
  createAuthProtocol,
} from './auth/better-auth.ts';
import { createIdentityAdapter } from './auth/actor.ts';
import { createSetupHandlers } from './auth/setup.ts';
import { createMailTransport } from './auth/mail.ts';
import {
  openAttachmentStore,
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import {
  classifyError,
  createProblem,
  problemMediaType,
} from './plugins/problem.ts';
import { baseSecurityHeaders } from './plugins/security-headers.ts';
import { sendStaticFile, statFile } from './plugins/static-assets.ts';
import { attachRequestLogging, redactUrl } from './request-log.ts';
import { createAttachmentCleanup } from './jobs/attachment-cleanup.ts';
import { createSyncCleanup } from './jobs/sync-cleanup.ts';
import { createServerLogger, errorName } from './logging.ts';

/**
 * Accepted shape of a caller supplied correlation id. It matches the contract
 * schema of the `x-request-id` header, so an echoed value always passes the
 * response check as well.
 */
const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

/** The caller's correlation id when it is usable, otherwise a new UUID. */
export function requestId(supplied: unknown): string {
  return typeof supplied === 'string' && requestIdPattern.test(supplied)
    ? supplied
    : randomUUID();
}

import { hostName } from './plugins/host.ts';
export { hostName } from './plugins/host.ts';
import { servedHostNames } from './served-origins.ts';

function instanceOf(request: FastifyRequest): string {
  return request.url.split('?')[0] ?? request.url;
}

/**
 * Keeps every response inside the contract. A status that the operation does
 * not declare becomes a generic server error instead of an undocumented body.
 */
function contractStatus(id: OperationId | undefined, status: number): number {
  if (id === undefined) return status;
  const operation = findOperation(id);
  const declared = (operation?.responses ?? []).some(
    (response) => response.status === status,
  );
  return declared ? status : 500;
}

/** Everything that a deployment or a test supplies besides configuration. */
export type AppOptions = {
  /** One handler per contract operation id. */
  readonly handlers: HandlerMap;
  /** Resolves the actor of an operation that declares a security scheme. */
  readonly identity?: IdentityResolver;
  /** Destination of the structured log, for tests that read log records. */
  readonly logStream?: { write: (line: string) => void };
  /** Maintained protocol libraries that serve part of the HTTP surface. */
  readonly protocols?: readonly ProtocolAdapter[];
  /** Optional custom readiness probes. */
  readonly probes?: readonly ReadinessProbe[];
  /**
   * The lifecycle state of the process, which the readiness answer reads.
   *
   * `createApp` passes it to the handlers that it builds. A caller that
   * supplies its own handler map wires the state into that map instead.
   */
  readonly lifecycle?: ServiceLifecycle;
  /** Custom web assets directory or null to disable web asset serving. */
  readonly webDist?: string | null;
};

/** Builds the application with an explicit handler map. */
export async function createAppWithHandlers(
  config: ServerConfig,
  options: AppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    // Request headers are never logged. Fastify's request serializer records
    // the method, the URL, the host name, and the peer address only, so a
    // credential in a header cannot reach a log record. Redaction by omission
    // is stronger than a redaction list, which only covers the header names
    // that someone remembered to add.
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            serializers: {
              req: (request: {
                readonly method?: unknown;
                readonly url?: unknown;
                readonly hostname?: unknown;
                readonly remoteAddress?: unknown;
              }) => ({
                method:
                  typeof request.method === 'string' ? request.method : '',
                url:
                  typeof request.url === 'string' ? redactUrl(request.url) : '',
                hostname:
                  typeof request.hostname === 'string' ? request.hostname : '',
                remoteAddress:
                  typeof request.remoteAddress === 'string'
                    ? request.remoteAddress
                    : '',
              }),
            },
            ...(options.logStream === undefined
              ? {}
              : { stream: options.logStream }),
          },
    bodyLimit: config.limits.bodyBytes,
    routerOptions: { maxParamLength: 256 },
    requestTimeout: config.limits.requestTimeoutMs,
    // Fastify's own header limit is a server option, so it is applied here
    // rather than per route.
    http: { maxHeaderSize: config.limits.headerBytes },
    genReqId: (request) => requestId(request.headers['x-request-id']),
    disableRequestLogging: true,
  });

  await app.register(rateLimit, { global: false });
  const logger = createServerLogger(app.log);

  attachRequestLogging(app);

  // One hook writes the security headers of every answer, including the ones
  // that the not-found handler, the error handler and a protocol adapter
  // produce. A route that needs a different content policy, such as an HTML
  // document, replaces that one header on its own reply.
  const securityHeaders = baseSecurityHeaders(config.origin);
  app.addHook('onRequest', async (_request, reply) => {
    for (const [name, value] of securityHeaders) reply.header(name, value);
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // A request that names a Host this deployment does not serve is rejected
  // before any handler runs. This blocks cache poisoning and absolute URL
  // rewriting through a forged Host header. The list is the host name of each
  // served origin, because a Host header carries no scheme. The origin itself
  // is checked by the cookie write check and by the identity routes, which
  // both read the same served origin list.
  const servedHosts = servedHostNames(config.servedOrigins);
  app.addHook('onRequest', async (request, reply) => {
    if (servedHosts.includes(hostName(request.headers.host))) return;
    const id = request.routeOptions.config.operationId;
    const status = contractStatus(id, 400);
    await reply
      .status(status)
      .header('content-type', `${problemMediaType}; charset=utf-8`)
      .send(
        createProblem({
          code: status === 400 ? 'host_not_allowed' : 'internal_error',
          status,
          detail: 'This deployment does not serve the requested Host.',
          instance: instanceOf(request),
          requestId: request.id,
        }),
      );
  });

  const defaultWebDist = resolve(import.meta.dirname, '../../web/dist/web');
  const webDist =
    options.webDist !== undefined
      ? options.webDist
      : existsSync(defaultWebDist)
        ? defaultWebDist
        : null;

  app.setNotFoundHandler(async (request, reply) => {
    if (
      webDist !== null &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      const rawPath = request.url.split('?')[0] ?? '/';
      const isApiPrefix =
        rawPath.startsWith('/api/') || rawPath.startsWith('/.well-known/');

      if (!isApiPrefix) {
        let decodedPath: string | null = null;
        try {
          decodedPath = decodeURIComponent(rawPath);
        } catch {
          // A malformed path is not a web asset. The normal not-found problem
          // response below handles it without exposing a filesystem detail.
        }
        // Decision 0013: source maps are not served. A `.map` request is never
        // a web asset and never falls back to the application shell, so the
        // built image serves no source map even though the build writes one.
        const isSourceMap =
          rawPath.toLowerCase().endsWith('.map') ||
          (decodedPath !== null && decodedPath.toLowerCase().endsWith('.map'));
        if (!isSourceMap && decodedPath !== null) {
          const targetPath = resolve(webDist, '.' + decodedPath);
          if (
            targetPath.startsWith(`${webDist}/`) &&
            statFile(targetPath) !== null
          ) {
            return sendStaticFile(request, reply, {
              filePath: targetPath,
              relativePath: relative(webDist, targetPath).split(sep).join('/'),
            });
          }
        }
        const indexPath = resolve(webDist, 'index.html');
        if (!isSourceMap && statFile(indexPath) !== null) {
          return sendStaticFile(request, reply, {
            filePath: indexPath,
            relativePath: 'index.html',
          });
        }
      }
    }

    await reply
      .status(404)
      .header('content-type', `${problemMediaType}; charset=utf-8`)
      .send(
        createProblem({
          code: 'route_not_found',
          status: 404,
          detail: 'No operation serves this method and path.',
          instance: instanceOf(request),
          requestId: request.id,
        }),
      );
  });

  app.setErrorHandler(async (error, request, reply) => {
    const classified = classifyError(error);
    const id = request.routeOptions.config.operationId;
    const status = contractStatus(id, classified.status);
    const code =
      status === classified.status ? classified.code : 'internal_error';
    // `setErrorHandler` replaces Fastify's own error logging, so a fault that
    // the client never sees in detail would otherwise leave no trace at all.
    // Every answer that classifies as an unexpected server error is logged
    // with the failure itself, under the request id that the caller received.
    if (code === 'internal_error')
      logger.bind({ requestId: request.id }).emit('http.request.failed', {
        operationId: id ?? null,
        errorName: errorName(error),
      });
    await reply
      .status(status)
      .header('content-type', `${problemMediaType}; charset=utf-8`)
      .send(
        createProblem({
          code,
          status,
          detail:
            status === classified.status
              ? classified.detail
              : 'The service failed to complete the request.',
          instance: instanceOf(request),
          requestId: request.id,
          ...(classified.issues.length > 0 && status === classified.status
            ? { issues: classified.issues }
            : {}),
          ...(classified.fileIds !== undefined && status === classified.status
            ? { fileIds: classified.fileIds }
            : {}),
        }),
      );
  });

  registerOperations(
    app,
    options.handlers,
    options.identity,
    options.protocols ?? [],
    config.rateLimit,
  );
  return app;
}

/**
 * Builds the application of this release.
 *
 * The composition owns the two identity connections. The Better Auth pool
 * never sets a transaction identity, which is what the row policies of the
 * identity tables expect. The account store always sets one, so every read and
 * write it performs is narrowed to that account and its workspaces. Both pools
 * close when the instance closes.
 */
export async function createApp(
  config: ServerConfig,
  options?: Partial<AppOptions>,
): Promise<FastifyInstance> {
  const identity = openIdentityStore(config.databaseUrl);
  // The content store uses the same runtime role. It opens its own pool,
  // because a content transaction holds the workspace lock for the length of a
  // changeset and must not queue behind an identity lookup.
  const content = openWorkspaceStore(config.databaseUrl);
  // The database probes read through the pool that serves the workspace
  // traffic, so a probe that an orchestrator repeats forever opens no
  // connection of its own and proves the path that a request takes.
  const probes = options?.probes ?? [
    configurationProbe(config),
    storageProbe(config.storageRoot),
    ...databaseProbes(() => content.probeDatabase()),
  ];
  const attachments = openAttachmentStore(
    config.databaseUrl,
    config.storageRoot,
  );
  const mail = createMailTransport(config.mail);
  // The protocol library writes into the application log. The sink is filled
  // once the instance exists, so nothing reaches the console in between.
  const sink: { write?: (record: AuthLogRecord) => void } = {};
  // Sign-up is enabled inside the protocol library, but its public route is
  // not mounted. The setup handler calls it only while no account exists.
  const authPool = createAuthPool(config);
  const auth = createAuth(
    config,
    { mail, allowSignUp: true, log: (record) => sink.write?.(record) },
    authPool,
  );
  const adapter = createIdentityAdapter({
    auth: auth.auth,
    identity,
    servedOrigins: config.servedOrigins,
  });
  const app = await createAppWithHandlers(config, {
    handlers: {
      ...createHandlers(config, probes, {
        store: identity,
        content,
        attachments,
        ...(options?.lifecycle === undefined
          ? {}
          : { lifecycle: options.lifecycle }),
      }),
      ...createSetupHandlers(auth.auth, identity, content),
    },
    identity: adapter.resolver,
    protocols: [createAuthProtocol(config, auth.auth)],
    probes,
    ...(options?.logStream !== undefined
      ? { logStream: options.logStream }
      : {}),
    ...(options?.webDist !== undefined ? { webDist: options.webDist } : {}),
  });
  const logger = createServerLogger(app.log);
  const cleanupSync = createSyncCleanup(content);
  const cleanupAttachments = createAttachmentCleanup(attachments);
  let cleanupRunning = false;
  const runCleanup = async (): Promise<void> => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    try {
      try {
        await cleanupSync();
      } catch {
        logger.emit('maintenance.failed', { job: 'sync' });
      }
      try {
        await cleanupAttachments();
      } catch {
        logger.emit('maintenance.failed', { job: 'attachments' });
      }
    } finally {
      cleanupRunning = false;
    }
  };
  const cleanupTimer = setInterval(() => void runCleanup(), 60 * 60 * 1000);
  cleanupTimer.unref();
  sink.write = (record): void => {
    if (record.level === 'error')
      logger.emit('auth.failed', { source: 'better-auth' });
    else if (record.level === 'warn')
      logger.emit('auth.warning', { source: 'better-auth' });
    else if (record.level === 'info')
      logger.emit('auth.info', { source: 'better-auth' });
    else logger.emit('auth.debug', { source: 'better-auth' });
  };
  app.addHook('onClose', async () => {
    clearInterval(cleanupTimer);
    await auth.close();
    await authPool.end();
    await attachments.close();
    await content.close();
    await identity.close();
  });
  return app;
}
