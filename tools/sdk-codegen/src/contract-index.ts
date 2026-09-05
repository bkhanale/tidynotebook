/**
 * Builds the runtime operation index from a dereferenced OpenAPI document.
 *
 * The index is the only contract data that reaches run time. It keeps one
 * schema per request slot and one schema per response status and media type,
 * so no schema is written twice and no handler can invent its own shape.
 */

const httpMethods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

export type HttpMethod = (typeof httpMethods)[number];

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

export type ParameterSerialization = {
  name: string;
  location: ParameterLocation;
  required: boolean;
  style: string;
  explode: boolean;
};

export type RequestSchemas = {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  body: Record<string, unknown> | null;
  bodyMediaType: string | null;
};

export type SecurityRequirement = Record<string, string[]>;

export type ResponseSchema = {
  status: number;
  mediaType: string;
  schema: Record<string, unknown>;
};

export type OperationEntry = {
  id: string;
  method: HttpMethod;
  path: string;
  /**
   * The protocol library that serves this operation, or null.
   *
   * A protocol operation is implemented by a maintained library rather than by
   * a contract handler, so the server registers it through that adapter's
   * exact path list and leaves it out of the one-handler-per-operation check.
   */
  protocol: string | null;
  security: SecurityRequirement[];
  parameters: ParameterSerialization[];
  request: RequestSchemas;
  responses: ResponseSchema[];
};

/** Extension that names the protocol library behind an operation. */
export const protocolExtension = 'x-notesapp-protocol';

export type ContractIndex = {
  version: string;
  operations: OperationEntry[];
};

function fail(message: string): never {
  throw new Error(`Contract index: ${message}`);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(`${where} must be an object.`);
  return Object.fromEntries(Object.entries(value));
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null;
  return Object.fromEntries(Object.entries(value));
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where} must be a string.`);
  return value;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function asArray(value: unknown, where: string): unknown[] {
  if (!isUnknownArray(value)) fail(`${where} must be an array.`);
  return [...value];
}

function isHttpMethod(value: string): value is HttpMethod {
  return (httpMethods as readonly string[]).includes(value);
}

function isParameterLocation(value: string): value is ParameterLocation {
  return ['path', 'query', 'header', 'cookie'].includes(value);
}

/** OpenAPI default serialization, stated explicitly so nothing is implied. */
function defaultStyle(location: ParameterLocation): string {
  return location === 'query' || location === 'cookie' ? 'form' : 'simple';
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
  closed: boolean,
): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties,
  };
  if (required.length > 0) schema.required = required;
  // A closed schema rejects an unknown member, and it is emitted even when the
  // operation declares no member of that kind. An operation without a query
  // parameter therefore rejects every query parameter. Headers stay open,
  // because a proxy, a browser, and the test runner all add headers that no
  // contract describes.
  if (closed) schema.additionalProperties = false;
  return schema;
}

function readParameters(
  raw: unknown[],
  where: string,
): ParameterSerialization[] {
  return raw.map((entry, position) => {
    const parameter = asRecord(entry, `${where} parameter ${position}`);
    const location = asString(parameter.in, `${where} parameter in`);
    if (!isParameterLocation(location))
      fail(`${where} parameter uses unsupported location ${location}.`);
    const required = parameter.required === true || location === 'path';
    // Every parameter must state its serialization, so a generated client and
    // the server cannot disagree about arrays or reserved characters.
    if (parameter.style === undefined || parameter.explode === undefined)
      fail(
        `${where} parameter ${asString(parameter.name, 'name')} must set style and explode.`,
      );
    const style = asString(
      parameter.style ?? defaultStyle(location),
      `${where} parameter style`,
    );
    return {
      name: asString(parameter.name, `${where} parameter name`),
      location,
      required,
      style,
      explode: parameter.explode === true,
    };
  });
}

function requestSchemas(
  parameters: ParameterSerialization[],
  raw: unknown[],
  operation: Record<string, unknown>,
  where: string,
): RequestSchemas {
  const groups: Record<
    'path' | 'query' | 'header',
    { properties: Record<string, unknown>; required: string[] }
  > = {
    path: { properties: {}, required: [] },
    query: { properties: {}, required: [] },
    header: { properties: {}, required: [] },
  };
  parameters.forEach((parameter, position) => {
    if (parameter.location === 'cookie') return;
    const group = groups[parameter.location];
    // Node lowercases every received header name.
    const key =
      parameter.location === 'header'
        ? parameter.name.toLowerCase()
        : parameter.name;
    const source = asRecord(raw[position], `${where} parameter ${position}`);
    group.properties[key] = asRecord(
      source.schema,
      `${where} parameter ${parameter.name} schema`,
    );
    if (parameter.required) group.required.push(key);
  });
  const body = optionalRecord(operation.requestBody);
  let bodySchema: Record<string, unknown> | null = null;
  let bodyMediaType: string | null = null;
  if (body !== null) {
    const content = asRecord(body.content, `${where} request body content`);
    const mediaTypes = Object.keys(content);
    if (mediaTypes.length !== 1)
      fail(`${where} request body must declare exactly one media type.`);
    bodyMediaType = mediaTypes[0] ?? fail(`${where} request body media type.`);
    const media = asRecord(
      content[bodyMediaType],
      `${where} request body media type`,
    );
    const declared = asRecord(media.schema, `${where} request body schema`);
    // A write body must reject an unknown member, otherwise a client can send
    // a field that no reviewer ever saw.
    if (declared.type === 'object' && declared.additionalProperties !== false)
      fail(`${where} request body must set additionalProperties to false.`);
    bodySchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...declared,
    };
  }
  return {
    params: objectSchema(
      groups.path.properties,
      groups.path.required.sort(),
      true,
    ),
    query: objectSchema(
      groups.query.properties,
      groups.query.required.sort(),
      true,
    ),
    headers: objectSchema(
      groups.header.properties,
      groups.header.required.sort(),
      false,
    ),
    body: bodySchema,
    bodyMediaType,
  };
}

function responseSchemas(
  operation: Record<string, unknown>,
  where: string,
): ResponseSchema[] {
  const responses = asRecord(operation.responses, `${where} responses`);
  const entries: ResponseSchema[] = [];
  for (const [code, value] of Object.entries(responses)) {
    if (!/^[1-5][0-9][0-9]$/.test(code))
      fail(`${where} response ${code} must use an exact status code.`);
    const response = asRecord(value, `${where} response ${code}`);
    const content = optionalRecord(response.content);
    if (content === null) continue;
    for (const [mediaType, media] of Object.entries(content)) {
      const schema = optionalRecord(
        asRecord(media, `${where} response ${code} ${mediaType}`).schema,
      );
      if (schema === null) continue;
      entries.push({
        status: Number(code),
        mediaType,
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          ...schema,
        },
      });
    }
  }
  return entries;
}

/** Security requirements of an operation, or the document default. */
function readSecurity(
  operation: Record<string, unknown>,
  root: Record<string, unknown>,
  where: string,
): SecurityRequirement[] {
  const declared =
    operation.security === undefined ? root.security : operation.security;
  if (declared === undefined) return [];
  const requirements = asArray(declared, `${where} security`);
  return requirements.map((entry, position) => {
    const requirement = asRecord(entry, `${where} security ${position}`);
    const result: SecurityRequirement = {};
    for (const [scheme, scopes] of Object.entries(requirement))
      result[scheme] = asArray(
        scopes,
        `${where} security ${scheme} scopes`,
      ).map((scope) => asString(scope, `${where} security ${scheme} scope`));
    return result;
  });
}

/** Builds the index from a fully dereferenced OpenAPI document. */
export function buildContractIndex(document: unknown): ContractIndex {
  const root = asRecord(document, 'document');
  const info = asRecord(root.info, 'info');
  const paths = asRecord(root.paths, 'paths');
  const operations: OperationEntry[] = [];
  const seen = new Set<string>();
  for (const [path, pathValue] of Object.entries(paths)) {
    const item = asRecord(pathValue, `path ${path}`);
    const shared: unknown[] = isUnknownArray(item.parameters)
      ? [...item.parameters]
      : [];
    for (const [method, methodValue] of Object.entries(item)) {
      if (!isHttpMethod(method)) continue;
      const where = `${method.toUpperCase()} ${path}`;
      const operation = asRecord(methodValue, where);
      const id = asString(operation.operationId, `${where} operationId`);
      if (seen.has(id)) fail(`operation id ${id} is used twice.`);
      seen.add(id);
      const raw = [
        ...shared,
        ...(operation.parameters === undefined
          ? []
          : asArray(operation.parameters, `${where} parameters`)),
      ];
      const parameters = readParameters(raw, where);
      const request = requestSchemas(parameters, raw, operation, where);
      const responses = responseSchemas(operation, where);
      // A write body needs a declared answer for a body that is too large and
      // for a media type the operation does not accept.
      if (request.body !== null)
        for (const required of [413, 415])
          if (!responses.some((response) => response.status === required))
            fail(
              `${where} has a request body, so it must declare a ${String(required)} response.`,
            );
      const protocol = operation[protocolExtension];
      if (protocol !== undefined && typeof protocol !== 'string')
        fail(`${where} ${protocolExtension} must be a string.`);
      operations.push({
        id,
        method,
        path,
        protocol: typeof protocol === 'string' ? protocol : null,
        security: readSecurity(operation, root, where),
        parameters,
        request,
        responses,
      });
    }
  }
  if (operations.length === 0) fail('the contract declares no operation.');
  operations.sort((left, right) => (left.id < right.id ? -1 : 1));
  return { version: asString(info.version, 'info.version'), operations };
}
