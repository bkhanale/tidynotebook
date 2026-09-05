/**
 * Server composition.
 *
 * `createApp` builds a Fastify instance that serves exactly the operations in
 * the contract. It adds the checks that every request passes through: a
 * request id, the Host allowlist, the configured body limit, contract request
 * validation, contract response validation, and problem details for every
 * failure.
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OperationId } from '@notesapp/api-contract';
import { findOperation } from '@notesapp/api-contract';
import type { ServerConfig } from './config.ts';
import { createHandlers } from './http/handlers.ts';
import type { HandlerMap, IdentityResolver } from './http/register.ts';
import { registerOperations } from './http/register.ts';
import {
  classifyError,
  createProblem,
  problemMediaType,
} from './http/problem.ts';

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

/**
 * Host header value without its port, lowercased.
 *
 * An IPv6 literal keeps its brackets, because `[::1]:8080` and `[::1]` name
 * the same host and a plain split on the colon would cut the address.
 */
export function hostName(host: string | undefined): string {
  const value = (host ?? '').trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(0, end + 1);
  }
  return value.split(':')[0] ?? '';
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

/** Everything that a deployment or a test supplies besides configuration. */
export type AppOptions = {
  /** One handler per contract operation id. */
  readonly handlers: HandlerMap;
  /** Resolves the actor of an operation that declares a security scheme. */
  readonly identity?: IdentityResolver;
  /** Destination of the structured log, for tests that read log records. */
  readonly logStream?: { write: (line: string) => void };
};

/** Builds the application with an explicit handler map. */
export function createAppWithHandlers(
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

  app.setNotFoundHandler(async (request, reply) => {
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
        }),
      );
  });

  registerOperations(app, options.handlers, options.identity);
  return Promise.resolve(app);
}

/** Builds the application with the handlers of this release. */
export function createApp(config: ServerConfig): Promise<FastifyInstance> {
  return createAppWithHandlers(config, { handlers: createHandlers(config) });
}
