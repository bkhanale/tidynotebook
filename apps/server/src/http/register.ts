/**
 * Registers every contract operation on a Fastify instance.
 *
 * The contract decides which routes exist. A handler map supplies one function
 * per operation id. A missing handler and an unknown handler are both startup
 * errors, so the contract and the server cannot drift apart silently.
 *
 * Fastify's own validator and serializer compilers are replaced here. The
 * default compilers use draft-07 Ajv and fast-json-stringify, and neither
 * understands the JSON Schema 2020-12 documents that this contract publishes.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifySchema,
  HTTPMethods,
} from 'fastify';
import type {
  HttpMethod,
  OperationId,
  RequestSlot,
} from '@notesapp/api-contract';
import {
  describeIssues,
  operations,
  requestValidator,
  responseValidator,
} from '@notesapp/api-contract';
import { RequestContractError, ResponseContractError } from './problem.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Contract operation that owns this route. */
    operationId?: OperationId;
  }
}

/** What the boundary does with a response media type. */
export type MediaHandling = 'json' | 'html' | 'binary';

/**
 * Media type handling table.
 *
 * A `json` media type is validated against the declared response schema before
 * it is sent. The `html` and `binary` rows are the documented hook for later
 * tasks: those responses carry bytes, so a later task adds size, access, and
 * caching checks there instead of JSON validation. No operation returns them
 * yet.
 */
export const mediaTypeHandling: Readonly<Record<string, MediaHandling>> = {
  'application/json': 'json',
  'application/problem+json': 'json',
  'text/html': 'html',
  'application/octet-stream': 'binary',
  'image/png': 'binary',
  'image/jpeg': 'binary',
  'image/gif': 'binary',
  'image/webp': 'binary',
};

/** One response produced by an operation handler. */
export type HandlerResult = {
  readonly status: number;
  readonly mediaType: string;
  readonly body: unknown;
};

/** Handler of one contract operation. */
export type OperationHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<HandlerResult>;

/** One handler for every operation id in the contract. */
export type HandlerMap = Readonly<Record<OperationId, OperationHandler>>;

/** Route method names, stated once so no cast is needed at registration. */
const routeMethods: Readonly<Record<HttpMethod, HTTPMethods>> = {
  get: 'GET',
  put: 'PUT',
  post: 'POST',
  delete: 'DELETE',
  options: 'OPTIONS',
  head: 'HEAD',
  patch: 'PATCH',
  trace: 'TRACE',
};

/** Turns an OpenAPI path template into a Fastify route path. */
export function toRoutePath(path: string): string {
  return path.replaceAll(/\{([^{}]+)\}/g, ':$1');
}

/** Media type without its parameters, lowercased. */
export function baseMediaType(value: unknown): string {
  if (typeof value !== 'string') return '';
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

function slotForHttpPart(part: string | undefined): RequestSlot | undefined {
  if (part === 'body') return 'body';
  if (part === 'querystring' || part === 'query') return 'query';
  if (part === 'params') return 'params';
  if (part === 'headers') return 'headers';
  return undefined;
}

// Replies whose response validation already failed. The failure reply is built
// by this server, so validating it a second time would only risk a loop.
const validationFailed = new WeakSet<FastifyReply>();

/**
 * Registers the contract on the instance. Throws before the server listens
 * when the handler map and the contract do not match exactly.
 */
export function registerOperations(
  app: FastifyInstance,
  handlers: HandlerMap,
): void {
  const declared = operations.map((operation) => operation.id);
  const provided = Object.keys(handlers);
  const missing = declared.filter((id) => !provided.includes(id));
  const unknown = provided.filter(
    (id) => !declared.some((declaredId) => declaredId === id),
  );
  if (missing.length > 0 || unknown.length > 0)
    throw new Error(
      [
        'The handler map does not match the contract.',
        ...missing.map((id) => `Missing handler for operation ${id}.`),
        ...unknown.map((id) => `Handler ${id} has no operation.`),
      ].join('\n'),
    );

  const routeOperations = new Map<string, OperationId>();
  for (const operation of operations)
    routeOperations.set(
      `${routeMethods[operation.method]} ${toRoutePath(operation.path)}`,
      operation.id,
    );

  app.setValidatorCompiler(({ method, url, httpPart }) => {
    const id = routeOperations.get(`${method.toUpperCase()} ${url}`);
    const slot = slotForHttpPart(httpPart);
    if (id === undefined || slot === undefined)
      throw new Error(
        `No contract validator for ${method} ${url} ${String(httpPart)}.`,
      );
    const validate = requestValidator(id, slot);
    if (validate === undefined)
      throw new Error(`The contract declares no ${slot} for operation ${id}.`);
    return (data: unknown) => {
      if (validate(data)) return { value: data };
      return {
        error: new RequestContractError(slot, describeIssues(validate.errors)),
      };
    };
  });

  // The contract already validated the payload in the preSerialization hook,
  // so serialization only has to write JSON. Fastify's default compiler would
  // build a fast-json-stringify serializer from a 2020-12 schema it cannot
  // read, and would silently drop members it does not understand.
  app.setSerializerCompiler(() => (data: unknown) => JSON.stringify(data));

  app.addHook('preSerialization', async (request, reply, payload: unknown) => {
    const id = request.routeOptions.config.operationId;
    if (id === undefined || validationFailed.has(reply)) return payload;
    const mediaType = baseMediaType(reply.getHeader('content-type'));
    if (mediaTypeHandling[mediaType] !== 'json') return payload;
    const validate = responseValidator(id, reply.statusCode, mediaType);
    if (validate === undefined || !validate(payload)) {
      validationFailed.add(reply);
      request.log.error(
        {
          operationId: id,
          status: reply.statusCode,
          mediaType,
          issues: validate === undefined ? [] : describeIssues(validate.errors),
        },
        'The service produced a response outside the contract.',
      );
      throw new ResponseContractError(reply.statusCode, mediaType);
    }
    return payload;
  });

  for (const operation of operations) {
    const schema: FastifySchema = {};
    if (operation.request.params !== null)
      schema.params = operation.request.params;
    if (operation.request.query !== null)
      schema.querystring = operation.request.query;
    if (operation.request.headers !== null)
      schema.headers = operation.request.headers;
    if (operation.request.body !== null) schema.body = operation.request.body;
    const response: Record<string, unknown> = {};
    for (const declaredResponse of operation.responses) {
      const key = String(declaredResponse.status);
      if (key in response)
        throw new Error(
          `Operation ${operation.id} declares status ${key} for more than one media type. The boundary supports one media type per status.`,
        );
      response[key] = declaredResponse.schema;
    }
    schema.response = response;
    const handler = handlers[operation.id];
    app.route({
      method: routeMethods[operation.method],
      url: toRoutePath(operation.path),
      config: { operationId: operation.id },
      schema,
      handler: async (request, reply) => {
        const result = await handler(request, reply);
        reply.status(result.status);
        reply.header('content-type', `${result.mediaType}; charset=utf-8`);
        return result.body;
      },
    });
  }
}
