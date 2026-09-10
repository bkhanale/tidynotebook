/**
 * Server composition.
 *
 * `createApp` builds a Fastify instance that serves exactly the operations in
 * the contract. It adds the checks that every request passes through: a
 * request id, the Host allowlist, the configured body limit, contract request
 * validation, contract response validation, and problem details for every
 * failure.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OperationId } from '@notesapp/api-contract';
import { findOperation } from '@notesapp/api-contract';
import type { ServerConfig } from './config.ts';
import {
  configurationProbe,
  createHandlers,
  databaseProbe,
  migrationProbe,
  storageProbe,
  type ReadinessProbe,
} from './http/handlers.ts';
import type {
  HandlerMap,
  IdentityResolver,
  ProtocolAdapter,
} from './http/register.ts';
import { registerOperations } from './http/register.ts';
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
} from './http/problem.ts';
import { WritePauseCoordinator } from './write-pause.ts';
import { MetricsCollector, attachObservability } from './observability.ts';
import { createAttachmentCleanup } from './jobs/attachment-cleanup.ts';
import { createSyncCleanup } from './jobs/sync-cleanup.ts';

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

import { hostName } from './http/host.ts';
export { hostName } from './http/host.ts';

/** Removes a legacy share secret before a request URL reaches a log. */
export function redactAccessUrl(url: string): string {
  const path = (url.split('?')[0] ?? url).replace(
    /^(\/s\/)[^/?]+(?:\/attachments\/[^/?]+)?/,
    '$1[redacted]',
  );
  return url.includes('?') ? `${path}?[redacted]` : path;
}

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

/** MIME content type mapping for web assets. */
function mimeTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs'))
    return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.webmanifest'))
    return 'application/manifest+json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  if (filePath.endsWith('.woff')) return 'font/woff';
  if (filePath.endsWith('.woff2')) return 'font/woff2';
  if (filePath.endsWith('.map')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
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
  /** Optional write-pause coordinator instance. */
  readonly writePause?: WritePauseCoordinator;
  /** Custom web assets directory or null to disable web asset serving. */
  readonly webDist?: string | null;
  /** Metrics collector instance. */
  readonly metrics?: MetricsCollector;
};

/** Builds the application with an explicit handler map. */
export function createAppWithHandlers(
  config: ServerConfig,
  options: AppOptions,
): Promise<FastifyInstance> {
  const writePause =
    options.writePause ?? new WritePauseCoordinator(config.storageRoot);
  const metrics = options.metrics ?? new MetricsCollector(config.storageRoot);

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
                  typeof request.url === 'string'
                    ? redactAccessUrl(request.url)
                    : '',
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
  });

  attachObservability(app, metrics);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // A request that names a Host this deployment does not serve is rejected
  // before any handler runs. This blocks cache poisoning and absolute URL
  // rewriting through a forged Host header.
  app.addHook('onRequest', async (request, reply) => {
    if (config.allowedHosts.includes(hostName(request.headers.host))) return;
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

  // Write mutations are blocked with 503 write_paused when maintenance is active.
  // This runs in onRequest so it fires before the preValidation identity check
  // that registerOperations installs, and before any body parsing.
  // The response is written through reply.raw and reply.hijack() so Fastify's
  // preSerialization hook does not validate it against the operation contract.
  // The write-pause 503 is a cross-cutting concern, not a per-operation response.
  app.addHook('onRequest', async (request, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const release = writePause.beginWrite();
      if (release === null) {
        const body = JSON.stringify(
          createProblem({
            code: 'write_paused',
            status: 503,
            detail: 'Write operations are paused for maintenance.',
            instance: instanceOf(request),
            requestId: request.id,
          }),
        );
        reply.hijack();
        reply.raw.writeHead(503, {
          'content-type': `${problemMediaType}; charset=utf-8`,
          'retry-after': '30',
          'content-length': Buffer.byteLength(body),
        });
        reply.raw.end(body);
        return;
      }
      reply.raw.on('finish', release);
      reply.raw.on('close', release);
    }
  });

  // Root health and readiness aliases for load balancers and orchestrators.
  app.get('/health', async (request, reply) => {
    const result = await options.handlers.getHealth?.(request, reply);
    if (result) {
      return reply
        .status(result.status)
        .header('content-type', result.mediaType)
        .send(result.body);
    }
    return reply.status(200).send({ status: 'ok' });
  });

  app.get('/ready', async (request, reply) => {
    const result = await options.handlers.getReadiness?.(request, reply);
    if (result) {
      return reply
        .status(result.status)
        .header('content-type', result.mediaType)
        .send(result.body);
    }
    return reply.status(503).send({ status: 'degraded' });
  });

  // Prometheus and JSON metrics endpoint.
  app.get('/metrics', async (request, reply) => {
    const accept = request.headers.accept ?? '';
    if (accept.includes('application/json')) {
      return reply
        .status(200)
        .type('application/json; charset=utf-8')
        .send(await metrics.toJson());
    }
    return reply
      .status(200)
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(await metrics.toPrometheusFormat());
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
        rawPath.startsWith('/api/') ||
        rawPath.startsWith('/s/') ||
        rawPath.startsWith('/.well-known/');

      if (!isApiPrefix) {
        let decodedPath: string | null = null;
        try {
          decodedPath = decodeURIComponent(rawPath);
        } catch {
          // A malformed path is not a web asset. The normal not-found problem
          // response below handles it without exposing a filesystem detail.
        }
        if (decodedPath !== null) {
          const targetPath = resolve(webDist, '.' + decodedPath);
          if (
            (targetPath === webDist || targetPath.startsWith(`${webDist}/`)) &&
            existsSync(targetPath)
          ) {
            const stat = statSync(targetPath);
            if (stat.isFile()) {
              const contentType = mimeTypeFor(targetPath);
              return reply
                .status(200)
                .header('content-type', contentType)
                .send(createReadStream(targetPath));
            }
          }
        }
        const indexPath = resolve(webDist, 'index.html');
        if (existsSync(indexPath)) {
          return reply
            .status(200)
            .header('content-type', 'text/html; charset=utf-8')
            .send(createReadStream(indexPath));
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
  );
  return Promise.resolve(app);
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
  const probes = options?.probes ?? [
    configurationProbe(config),
    databaseProbe(config.databaseUrl),
    storageProbe(config.storageRoot),
    migrationProbe(config.databaseUrl),
  ];
  const writePause =
    options?.writePause ?? new WritePauseCoordinator(config.storageRoot);
  const metrics = options?.metrics ?? new MetricsCollector(config.storageRoot);

  const identity = openIdentityStore(config.databaseUrl);
  // The content store uses the same runtime role. It opens its own pool,
  // because a content transaction holds the workspace lock for the length of a
  // changeset and must not queue behind an identity lookup.
  const content = openWorkspaceStore(config.databaseUrl);
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
    origin: config.origin,
  });
  const app = await createAppWithHandlers(config, {
    handlers: {
      ...createHandlers(config, probes, {
        store: identity,
        content,
        attachments,
      }),
      ...createSetupHandlers(auth.auth, identity),
    },
    identity: adapter.resolver,
    protocols: [createAuthProtocol(config, auth.auth)],
    probes,
    writePause,
    metrics,
    ...(options?.logStream !== undefined
      ? { logStream: options.logStream }
      : {}),
    ...(options?.webDist !== undefined ? { webDist: options.webDist } : {}),
  });
  const cleanupSync = createSyncCleanup(content, writePause);
  const cleanupAttachments = createAttachmentCleanup(attachments, writePause);
  let cleanupRunning = false;
  const runCleanup = async (): Promise<void> => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    try {
      await cleanupSync();
      await cleanupAttachments();
    } catch {
      app.log.error({ source: 'cleanup' }, 'A cleanup job failed.');
    } finally {
      cleanupRunning = false;
    }
  };
  const cleanupTimer = setInterval(() => void runCleanup(), 60 * 60 * 1000);
  cleanupTimer.unref();
  sink.write = (record): void => {
    const where = { source: 'better-auth' };
    // The level is chosen explicitly rather than by index, so the logger keeps
    // its own receiver.
    if (record.level === 'error') app.log.error(where, record.message);
    else if (record.level === 'warn') app.log.warn(where, record.message);
    else if (record.level === 'info') app.log.info(where, record.message);
    else app.log.debug(where, record.message);
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
