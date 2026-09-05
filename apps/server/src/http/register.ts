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
import { Buffer } from 'node:buffer';
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
  SecurityRequirement,
  ValidationIssue,
} from '@notesapp/api-contract';
import {
  describeIssues,
  findOperation,
  operations,
  requestValidator,
  responseMediaTypes,
  responseValidator,
} from '@notesapp/api-contract';
import {
  RequestContractError,
  RequestMediaTypeError,
  ResponseContractError,
} from './problem.ts';

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
 * yet. A media type outside this table cannot leave the boundary.
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

/**
 * One handler for every contract operation that this server implements.
 *
 * An operation that a protocol library serves has no entry here. Such an
 * operation carries a `protocol` marker in the contract, and its route comes
 * from that adapter's exact path list instead.
 */
export type HandlerMap = Readonly<
  Partial<Record<OperationId, OperationHandler>>
>;

/**
 * A maintained protocol library that serves part of the HTTP surface.
 *
 * The adapter states the exact routes it serves, so a library release that
 * adds an endpoint cannot widen the surface without a reviewed change. Every
 * contract operation that names this protocol must appear in that list, and
 * startup fails when one does not.
 */
export type ProtocolAdapter = {
  /** Value of the operation marker that this adapter answers for. */
  readonly protocol: string;
  /** Exact method and route path pairs that the adapter serves. */
  readonly routes: readonly {
    readonly method: 'GET' | 'POST';
    readonly path: string;
  }[];
  /**
   * Serves one request and returns its answer.
   *
   * The answer is returned rather than written, so the boundary can check it
   * against the declared response schema before the framework sends it.
   */
  readonly handle: (request: FastifyRequest) => Promise<ProtocolResult>;
};

/** One answer of a protocol adapter. */
export type ProtocolResult = {
  readonly status: number;
  readonly mediaType: string;
  /** Headers to copy, without `set-cookie` and without a content type. */
  readonly headers: readonly (readonly [string, string])[];
  /** Complete `set-cookie` values. */
  readonly cookies: readonly string[];
  /** The parsed JSON answer, or undefined when the answer carries none. */
  readonly body: unknown;
  /** The bytes of an answer that is not JSON, for example a redirect page. */
  readonly bytes: Uint8Array | null;
};

/**
 * Resolves the actor of a request before its input is validated.
 *
 * Task 5 supplies the implementation. It receives the operation id and the
 * security requirements that the contract declares for it, and it rejects the
 * request by throwing when the actor cannot satisfy any of them.
 */
export type IdentityResolver = (
  request: FastifyRequest,
  operation: {
    readonly id: OperationId;
    readonly security: readonly SecurityRequirement[];
  },
) => Promise<void>;

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

/** True when the request carries a body of its own. */
function carriesBody(request: FastifyRequest): boolean {
  const length = request.headers['content-length'];
  if (typeof length === 'string' && Number(length) > 0) return true;
  return typeof request.headers['transfer-encoding'] === 'string';
}

/** What is wrong with the media type of a request body, if anything. */
export type BodyMediaTypeIssue = 'no_body_allowed' | 'unsupported_media_type';

/**
 * Compares a request body with the body the operation declares.
 *
 * No operation accepts a request body yet, so this function is covered by unit
 * tests only. The first operation that declares a `requestBody`, in Task 5 or
 * Task 6, adds the integration test that sends a wrong media type.
 */
export function checkBodyMediaType(
  declared: string | null,
  contentType: unknown,
  carries: boolean,
): BodyMediaTypeIssue | null {
  if (declared === null) return carries ? 'no_body_allowed' : null;
  // An absent body is a schema matter, not a media type matter.
  if (!carries) return null;
  return baseMediaType(contentType) === declared
    ? null
    : 'unsupported_media_type';
}

/**
 * True when a value can be written as a JSON document.
 *
 * A string, a byte buffer, and a stream are all sent verbatim by the
 * framework, so no schema check would ever see their members. A handler that
 * serialized its own answer has left the contract.
 */
export function isJsonPayload(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return false;
  return !('pipe' in value) && !(Symbol.asyncIterator in value);
}

/** Reports a response that left the contract and stops it from being sent. */
function rejectResponse(
  request: FastifyRequest,
  detail: {
    readonly operationId: OperationId;
    readonly status: number;
    readonly mediaType: string;
    readonly declaredMediaTypes: readonly string[];
    readonly reason: string;
    readonly issues: readonly ValidationIssue[];
  },
): never {
  // The rejected body is never logged, so the failure cannot leak the content
  // that the contract refused.
  request.log.error(
    { requestId: request.id, ...detail },
    'The service produced a response outside the contract.',
  );
  throw new ResponseContractError(detail.status, detail.mediaType);
}

/**
 * Checks the answer of a handler before the framework touches it.
 *
 * The member check runs later, in `preSerialization`. This check runs first,
 * because a pre-serialized string, a buffer, and a stream never reach that
 * hook in a form any schema can read.
 */
function checkHandlerResult(
  request: FastifyRequest,
  operationId: OperationId,
  result: HandlerResult,
): void {
  const declaredMediaTypes = responseMediaTypes(operationId, result.status);
  const handling = mediaTypeHandling[result.mediaType];
  const shared = {
    operationId,
    status: result.status,
    mediaType: result.mediaType,
    declaredMediaTypes,
    issues: [],
  };
  if (!declaredMediaTypes.includes(result.mediaType))
    rejectResponse(request, {
      ...shared,
      reason: 'the operation declares no such media type for this status',
    });
  if (handling === undefined)
    rejectResponse(request, {
      ...shared,
      reason: 'the boundary serves no such media type',
    });
  if (handling === 'json' && !isJsonPayload(result.body))
    rejectResponse(request, {
      ...shared,
      reason: 'a JSON answer must be an object or an array, not bytes or text',
    });
}

/** The part of an operation that the startup checks read. */
export type RegistrationEntry = {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly protocol: string | null;
  readonly parameters: readonly {
    readonly name: string;
    readonly location: string;
    readonly style: string;
    readonly explode: boolean;
  }[];
  readonly security: readonly SecurityRequirement[];
};

/**
 * Rejects a registration that the boundary cannot serve. Every failure here
 * stops startup, so no deployment can answer a request it does not understand.
 *
 * Only the parameter forms that the current operations use are supported. A
 * later task that needs an array parameter must add its parsing in the same
 * change that declares it, instead of relying on an unstated default.
 */
export function checkRegistration(
  entries: readonly RegistrationEntry[],
  handlerIds: readonly string[],
  hasIdentity: boolean,
  protocols: readonly ProtocolAdapter[] = [],
): void {
  const served = entries.filter((entry) => entry.protocol === null);
  const declared = served.map((entry) => entry.id);
  const missing = declared.filter((id) => !handlerIds.includes(id));
  const unknown = handlerIds.filter((id) => !declared.includes(id));
  const failures = [
    ...missing.map((id) => `Missing handler for operation ${id}.`),
    ...unknown.map((id) => `Handler ${id} has no operation.`),
  ];
  // A protocol operation needs an adapter that states its exact route, so the
  // contract and the mounted library cannot drift apart either.
  for (const entry of entries) {
    if (entry.protocol === null) continue;
    const adapter = protocols.find(
      (candidate) => candidate.protocol === entry.protocol,
    );
    if (adapter === undefined) {
      failures.push(
        `Operation ${entry.id} names protocol ${entry.protocol}, which no adapter serves.`,
      );
      continue;
    }
    const route = toRoutePath(entry.path);
    if (
      !adapter.routes.some(
        (candidate) =>
          candidate.path === route &&
          candidate.method === entry.method.toUpperCase(),
      )
    )
      failures.push(
        `Operation ${entry.id} is not in the exact path list of protocol ${entry.protocol}.`,
      );
  }
  for (const entry of served) {
    for (const parameter of entry.parameters) {
      const where = `Operation ${entry.id} parameter ${parameter.name}`;
      if (parameter.location === 'cookie')
        failures.push(`${where} is a cookie parameter, which is not served.`);
      else if (parameter.location === 'query') {
        if (parameter.style !== 'form' || !parameter.explode)
          failures.push(
            `${where} must use style form with explode true. The boundary serves no other query form yet.`,
          );
      } else if (parameter.style !== 'simple')
        failures.push(
          `${where} must use style simple. The boundary serves no other ${parameter.location} form yet.`,
        );
    }
    // Every operation that names a security scheme needs an actor before its
    // input is validated. Task 5 supplies that resolver; until then an
    // operation that declares one cannot start.
    if (entry.security.length > 0 && !hasIdentity)
      failures.push(
        `Operation ${entry.id} declares a security requirement, but no identity resolver was supplied.`,
      );
  }
  if (failures.length > 0)
    throw new Error(
      ['The server cannot serve this contract.', ...failures].join('\n'),
    );
}

// Replies whose response validation already failed. The failure reply is built
// by this server, so validating it a second time would only risk a loop.
const validationFailed = new WeakSet<FastifyReply>();

/**
 * Registers the contract on the instance. Throws before the server listens
 * when the handler map and the contract do not match exactly, when an
 * operation needs an identity resolver that was not supplied, or when a
 * parameter uses a serialization that the boundary does not implement.
 */
export function registerOperations(
  app: FastifyInstance,
  handlers: HandlerMap,
  identity?: IdentityResolver,
  protocols: readonly ProtocolAdapter[] = [],
): void {
  checkRegistration(
    operations,
    Object.keys(handlers),
    identity !== undefined,
    protocols,
  );

  const served = operations.filter((operation) => operation.protocol === null);
  const routeOperations = new Map<string, OperationId>();
  for (const operation of served) {
    const route = toRoutePath(operation.path);
    routeOperations.set(
      `${routeMethods[operation.method]} ${route}`,
      operation.id,
    );
    // Fastify serves HEAD for every GET route. That route shares the GET
    // schemas, so its validators resolve to the same operation.
    if (operation.method === 'get')
      routeOperations.set(`HEAD ${route}`, operation.id);
  }

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

  app.addHook('preValidation', async (request) => {
    const id = request.routeOptions.config.operationId;
    if (id === undefined) return;
    const operation = findOperation(id);
    if (operation === undefined) return;
    // An operation that declares no request body accepts none, and one that
    // does accepts only its declared media type. Fastify does not parse a body
    // for every method, so the check reads the request framing headers instead
    // of the parsed value.
    const issue = checkBodyMediaType(
      operation.request.bodyMediaType,
      request.headers['content-type'],
      carriesBody(request),
    );
    if (issue === 'no_body_allowed')
      throw new RequestContractError('body', [
        { path: '/', message: 'this operation accepts no request body' },
      ]);
    if (issue === 'unsupported_media_type')
      throw new RequestMediaTypeError(operation.request.bodyMediaType ?? '');
    if (operation.security.length === 0) return;
    if (identity === undefined)
      throw new Error(`Operation ${id} has no identity resolver.`);
    await identity(request, { id, security: operation.security });
  });

  app.addHook('preSerialization', async (request, reply, payload: unknown) => {
    const id = request.routeOptions.config.operationId;
    if (id === undefined || validationFailed.has(reply)) return payload;
    const mediaType = baseMediaType(reply.getHeader('content-type'));
    const declaredTypes = responseMediaTypes(id, reply.statusCode);
    const handling = mediaTypeHandling[mediaType];
    const validate = declaredTypes.includes(mediaType)
      ? responseValidator(id, reply.statusCode, mediaType)
      : undefined;
    // A media type the operation does not declare for this status leaves the
    // contract just as much as an undeclared member does.
    if (
      !declaredTypes.includes(mediaType) ||
      handling === undefined ||
      (handling === 'json' && (validate === undefined || !validate(payload)))
    ) {
      validationFailed.add(reply);
      rejectResponse(request, {
        operationId: id,
        status: reply.statusCode,
        mediaType,
        declaredMediaTypes: declaredTypes,
        reason: 'the response body does not match the declared schema',
        issues: validate === undefined ? [] : describeIssues(validate.errors),
      });
    }
    return payload;
  });

  const protocolRoutes = new Map<string, OperationId>();
  for (const operation of operations) {
    if (operation.protocol === null) continue;
    protocolRoutes.set(
      `${operation.method.toUpperCase()} ${toRoutePath(operation.path)}`,
      operation.id,
    );
  }
  for (const adapter of protocols)
    registerProtocol(app, adapter, protocolRoutes);

  for (const operation of served) {
    const schema: FastifySchema = {
      params: operation.request.params,
      querystring: operation.request.query,
      headers: operation.request.headers,
    };
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
    if (handler === undefined)
      throw new Error(`Operation ${operation.id} has no handler.`);
    app.route({
      method: routeMethods[operation.method],
      url: toRoutePath(operation.path),
      config: { operationId: operation.id },
      schema,
      handler: async (request, reply) => {
        const result = await handler(request, reply);
        checkHandlerResult(request, operation.id, result);
        reply.status(result.status);
        reply.header('content-type', `${result.mediaType}; charset=utf-8`);
        return result.body;
      },
    });
  }
}

/**
 * Reads the raw request body of a protocol route as JSON.
 *
 * The adapter receives the bytes the client sent, because a protocol library
 * may sign or hash what it received. The boundary still parses a copy, so a
 * declared request body is validated against its schema like any other.
 */
function readRawJson(request: FastifyRequest): unknown {
  const body = request.body;
  if (!Buffer.isBuffer(body) || body.length === 0) return undefined;
  const text = body.toString('utf8');
  if (text.trim() === '') return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    throw new RequestContractError('body', [
      { path: '/', message: 'the request body is not valid JSON' },
    ]);
  }
}

/**
 * Mounts one protocol adapter on its exact routes.
 *
 * The routes live in their own encapsulated scope with a raw body parser, so
 * the adapter receives the bytes the client sent. A route that a contract
 * operation describes is still checked at both ends: its declared request body
 * is validated before the library runs, and its answer is validated against
 * the declared response schema before the framework sends it. The library
 * still owns its own credential checks, so no identity hook runs here.
 *
 * A route with no contract operation, such as the provider callback, answers
 * with a redirect and is served without those checks.
 */
function registerProtocol(
  app: FastifyInstance,
  adapter: ProtocolAdapter,
  byRoute: ReadonlyMap<string, OperationId>,
): void {
  app.register((scope, _options, done) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      /.*/,
      { parseAs: 'buffer' },
      (_request, body, next) => {
        next(null, body);
      },
    );
    for (const route of adapter.routes) {
      const id = byRoute.get(`${route.method} ${route.path}`);
      scope.route({
        method: route.method,
        url: route.path,
        ...(id === undefined ? {} : { config: { operationId: id } }),
        handler: async (request, reply) => {
          if (id !== undefined) checkProtocolRequest(id, request);
          const result = await adapter.handle(request);
          if (id !== undefined) checkProtocolResponse(request, id, result);
          for (const [name, value] of result.headers) reply.header(name, value);
          if (result.cookies.length > 0)
            reply.header('set-cookie', [...result.cookies]);
          reply.status(result.status);
          if (result.bytes !== null) {
            if (result.mediaType !== '')
              reply.header('content-type', result.mediaType);
            await reply.send(Buffer.from(result.bytes));
            return;
          }
          reply.header('content-type', `${result.mediaType}; charset=utf-8`);
          await reply.send(JSON.stringify(result.body ?? null));
        },
      });
    }
    done();
  });
}

/** Validates the declared slots of a protocol request. */
function checkProtocolRequest(id: OperationId, request: FastifyRequest): void {
  const operation = findOperation(id);
  if (operation === undefined) return;
  const slots: readonly (readonly [RequestSlot, unknown])[] = [
    ['params', request.params],
    ['query', request.query],
    ['headers', request.headers],
    ...(operation.request.body === null
      ? []
      : ([['body', readRawJson(request)]] as const)),
  ];
  for (const [slot, value] of slots) {
    const validate = requestValidator(id, slot);
    if (validate === undefined) continue;
    if (!validate(value))
      throw new RequestContractError(slot, describeIssues(validate.errors));
  }
}

/** Validates the answer of a protocol route against the contract. */
function checkProtocolResponse(
  request: FastifyRequest,
  id: OperationId,
  result: ProtocolResult,
): void {
  const declaredMediaTypes = responseMediaTypes(id, result.status);
  const shared = {
    operationId: id,
    status: result.status,
    mediaType: result.mediaType,
    declaredMediaTypes,
    issues: [],
  };
  if (result.bytes !== null) {
    // A protocol operation describes a JSON answer. A redirect belongs to a
    // route that the contract does not describe.
    rejectResponse(request, {
      ...shared,
      reason: 'a protocol operation must answer with JSON',
    });
  }
  if (!declaredMediaTypes.includes(result.mediaType))
    rejectResponse(request, {
      ...shared,
      reason: 'the operation declares no such media type for this status',
    });
  const validate = responseValidator(id, result.status, result.mediaType);
  if (validate === undefined)
    rejectResponse(request, {
      ...shared,
      reason: 'the contract declares no validator for this answer',
    });
  if (!validate(result.body ?? null))
    rejectResponse(request, {
      ...shared,
      reason: 'the response body does not match the declared schema',
      issues: describeIssues(validate.errors),
    });
}
