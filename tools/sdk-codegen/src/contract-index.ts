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
  params: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  headers: Record<string, unknown> | null;
  body: Record<string, unknown> | null;
  bodyMediaType: string | null;
};

export type ResponseSchema = {
  status: number;
  mediaType: string;
  schema: Record<string, unknown>;
};

export type OperationEntry = {
  id: string;
  method: HttpMethod;
  path: string;
  parameters: ParameterSerialization[];
  request: RequestSchemas;
  responses: ResponseSchema[];
};

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
): Record<string, unknown> | null {
  if (Object.keys(properties).length === 0) return null;
  const schema: Record<string, unknown> = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties,
  };
  if (required.length > 0) schema.required = required;
  // A closed schema rejects an unknown member. Headers stay open because a
  // proxy, a browser, or the test runner adds headers that the contract does
  // not describe.
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
    bodySchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...asRecord(media.schema, `${where} request body schema`),
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
      operations.push({
        id,
        method,
        path,
        parameters,
        request: requestSchemas(parameters, raw, operation, where),
        responses: responseSchemas(operation, where),
      });
    }
  }
  if (operations.length === 0) fail('the contract declares no operation.');
  operations.sort((left, right) => (left.id < right.id ? -1 : 1));
  return { version: asString(info.version, 'info.version'), operations };
}
