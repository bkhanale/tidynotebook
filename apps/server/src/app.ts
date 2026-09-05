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
import type { HandlerMap } from './http/register.ts';
import { registerOperations } from './http/register.ts';
import {
  classifyError,
  createProblem,
  problemMediaType,
} from './http/problem.ts';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The caller's correlation id when it is a UUID, otherwise a new one. */
function requestId(headers: Readonly<Record<string, unknown>>): string {
  const supplied: unknown = headers['x-request-id'];
  return typeof supplied === 'string' && uuidPattern.test(supplied)
    ? supplied
    : randomUUID();
}

/** Host header value without its port, lowercased. */
function hostName(request: FastifyRequest): string {
  const host = request.headers.host ?? '';
  return (host.split(':')[0] ?? '').toLowerCase();
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

/** Builds the application with an explicit handler map. */
export function createAppWithHandlers(
  config: ServerConfig,
  handlers: HandlerMap,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // The contract decides which routes exist. Fastify would otherwise add a
    // HEAD route for every GET route, and that route has no operation id, no
    // declared response, and no handler in the map.
    exposeHeadRoutes: false,
    bodyLimit: config.limits.bodyBytes,
    routerOptions: { maxParamLength: 256 },
    requestTimeout: config.limits.requestTimeoutMs,
    // Fastify's own header limit is a server option, so it is applied here
    // rather than per route.
    http: { maxHeaderSize: config.limits.headerBytes },
    genReqId: (request) => requestId(request.headers),
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // A request that names a Host this deployment does not serve is rejected
  // before any handler runs. This blocks cache poisoning and absolute URL
  // rewriting through a forged Host header.
  app.addHook('onRequest', async (request, reply) => {
    if (config.allowedHosts.includes(hostName(request))) return;
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

  registerOperations(app, handlers);
  return Promise.resolve(app);
}

/** Builds the application with the handlers of this release. */
export function createApp(config: ServerConfig): Promise<FastifyInstance> {
  return createAppWithHandlers(config, createHandlers(config));
}
