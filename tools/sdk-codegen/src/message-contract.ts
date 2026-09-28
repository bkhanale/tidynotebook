/**
 * Reads the message contract of `asyncapi.yaml` and checks it against the
 * HTTP contract.
 *
 * OpenAPI owns the HTTP upgrade and AsyncAPI owns the messages of the stream
 * that the upgrade opens (record 0126). The two documents meet at three
 * points, and this module refuses any disagreement at each one:
 *
 * - The channel address is the path of exactly one upgrade operation, which
 *   is a GET that declares a 101 answer, and each such operation has exactly
 *   one channel.
 * - The subprotocol header of the channel binding and the subprotocol header
 *   parameter of the upgrade operation name one schema, which holds one
 *   string constant.
 * - Each message payload is a schema component that the HTTP contract also
 *   lists with the same content, so Hey API writes its type and Ajv compiles
 *   its validator from the one file that states it.
 *
 * Each message names its kind in a `kind` member that holds one string
 * constant. The kind is the message name and the key of the message in its
 * channel, and no two messages share one, so a reader of a frame picks the
 * schema from the kind alone.
 *
 * The documents are the bundled source forms. The pinned Redocly CLI keeps a
 * reference to a schema component when it bundles `asyncapi.yaml`, but it
 * writes a channel, a message and a security scheme in full at each place
 * that names one. So an operation finds its channel by the address, a message
 * by its name, and a security scheme by its content, and every declared
 * security scheme must serve an operation.
 */

type Json = Record<string, unknown>;

/** Who sends a message: the browser or the server. */
export type MessageDirection = 'client' | 'server';

/** One message of a channel. */
export type MessageEntry = {
  /** The value of the `kind` member, which is also the message name. */
  readonly kind: string;
  /** The schema component that states the payload. */
  readonly schema: string;
  readonly direction: MessageDirection;
};

/** One channel and the HTTP operation that opens it. */
export type ChannelEntry = {
  /** The key of the channel in `asyncapi.yaml`. */
  readonly name: string;
  readonly address: string;
  /** The operation id of the HTTP upgrade. */
  readonly operationId: string;
  /** The one WebSocket subprotocol of the channel. */
  readonly subprotocol: string;
  readonly messages: readonly MessageEntry[];
};

export type MessageContract = {
  readonly version: string;
  readonly channels: readonly ChannelEntry[];
};

/** The AsyncAPI version that the pinned tools were proved against. */
export const asyncApiVersion = '3.0.0';

/** The header that carries the WebSocket subprotocol, in lower case. */
const subprotocolHeader = 'sec-websocket-protocol';

const schemaPrefix = '#/components/schemas/';

function fail(message: string): never {
  throw new Error(`Message contract: ${message}`);
}

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, where: string): Json {
  if (!isRecord(value)) fail(`${where} must be an object.`);
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where} must be a string.`);
  return value;
}

function list(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${where} must be a list.`);
  return value;
}

/** The value a local JSON pointer names. */
function resolve(document: Json, pointer: string, where: string): unknown {
  if (!pointer.startsWith('#/')) fail(`${where} must be a local reference.`);
  let current: unknown = document;
  for (const raw of pointer.slice(2).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isRecord(current) || !(key in current))
      fail(`${where} names ${pointer}, which does not exist.`);
    current = current[key];
  }
  return current;
}

/** The target of a reference object, as a pointer. */
function referenceOf(value: unknown, where: string): string {
  const reference = record(value, where).$ref;
  if (typeof reference !== 'string') fail(`${where} must be a reference.`);
  return reference;
}

/** The schema component name of a reference to one. */
function schemaName(value: unknown, where: string): string {
  const reference = referenceOf(value, where);
  if (
    !reference.startsWith(schemaPrefix) ||
    reference.slice(schemaPrefix.length).includes('/')
  )
    fail(`${where} must reference a schema component, not ${reference}.`);
  return reference.slice(schemaPrefix.length);
}

/** The one string constant of a schema component. */
function constantOf(document: Json, name: string, where: string): string {
  const schema = record(
    resolve(document, `${schemaPrefix}${name}`, where),
    where,
  );
  if (schema.type !== 'string' || typeof schema.const !== 'string')
    fail(`${where} must be a string schema with one constant.`);
  return schema.const;
}

/** The `kind` constant of a payload schema. */
function kindOf(document: Json, name: string, where: string): string {
  const schema = record(
    resolve(document, `${schemaPrefix}${name}`, where),
    where,
  );
  if (schema.type !== 'object' || schema.additionalProperties !== false)
    fail(`${where} must be a closed object schema.`);
  const required = list(schema.required ?? [], `${where} required`);
  if (!required.includes('kind')) fail(`${where} must require kind.`);
  const properties = record(schema.properties, `${where} properties`);
  const kind = record(properties.kind, `${where} kind`);
  if (kind.type !== 'string' || typeof kind.const !== 'string')
    fail(`${where} kind must be a string with one constant.`);
  return kind.const;
}

/** The HTTP operations that declare a 101 answer, by path. */
function upgradeOperations(
  openapi: Json,
): Map<string, { id: string; subprotocolSchema: string }> {
  const upgrades = new Map<string, { id: string; subprotocolSchema: string }>();
  const paths = record(openapi.paths, 'the HTTP paths');
  for (const [path, value] of Object.entries(paths)) {
    const item = record(value, `the HTTP path ${path}`);
    for (const [method, operationValue] of Object.entries(item)) {
      if (!isRecord(operationValue) || !isRecord(operationValue.responses))
        continue;
      if (!('101' in operationValue.responses)) continue;
      const id = text(operationValue.operationId, `${path} operationId`);
      const where = `the upgrade operation ${id}`;
      if (method !== 'get') fail(`${where} must be a GET.`);
      const parameters = list(
        operationValue.parameters ?? [],
        `${where} parameters`,
      ).map((entry) => {
        const pointer = isRecord(entry) ? entry.$ref : undefined;
        return typeof pointer === 'string'
          ? record(resolve(openapi, pointer, where), where)
          : record(entry, where);
      });
      const header = parameters.find(
        (parameter) =>
          parameter.in === 'header' &&
          typeof parameter.name === 'string' &&
          parameter.name.toLowerCase() === subprotocolHeader,
      );
      if (header === undefined || header.required !== true)
        fail(`${where} must require the ${subprotocolHeader} header.`);
      if (upgrades.has(path)) fail(`the path ${path} has two upgrades.`);
      upgrades.set(path, {
        id,
        subprotocolSchema: schemaName(header.schema, `${where} subprotocol`),
      });
    }
  }
  return upgrades;
}

/** Every payload schema must be one component that both documents list. */
function assertSharedSchemas(asyncapi: Json, openapi: Json): void {
  const asyncSchemas = record(
    record(asyncapi.components ?? {}, 'the message components').schemas ?? {},
    'the message schemas',
  );
  const httpSchemas = record(
    record(openapi.components, 'the HTTP components').schemas,
    'the HTTP schemas',
  );
  for (const [name, schema] of Object.entries(asyncSchemas)) {
    if (!(name in httpSchemas))
      fail(
        `the schema ${name} is not listed in openapi.yaml, so no type is generated for it.`,
      );
    if (JSON.stringify(schema) !== JSON.stringify(httpSchemas[name]))
      fail(
        `the schema ${name} differs between the two documents. Both must reference one file.`,
      );
  }
}

/** A value, or the value that its reference names. */
function target(document: Json, value: unknown, where: string): Json {
  if (isRecord(value) && typeof value.$ref === 'string')
    return record(resolve(document, value.$ref, where), where);
  return record(value, where);
}

/** The key of the channel that an operation names, found by its address. */
function channelOf(asyncapi: Json, value: unknown, where: string): string {
  const address = text(target(asyncapi, value, where).address, where);
  const names = Object.entries(record(asyncapi.channels, 'the channels'))
    .filter(([, channel]) => isRecord(channel) && channel.address === address)
    .map(([name]) => name);
  const [name, ...others] = names;
  if (name === undefined || others.length > 0)
    fail(`${where} names the address ${address}, which is not one channel.`);
  return name;
}

/** The security schemes that an operation names, found by their content. */
function schemesOf(asyncapi: Json, value: unknown, where: string): string[] {
  const declared = Object.entries(
    record(
      record(asyncapi.components ?? {}, 'the components').securitySchemes ?? {},
      'the security schemes',
    ),
  );
  const named = list(value ?? [], where).map((entry, position) => {
    const scheme = JSON.stringify(
      target(asyncapi, entry, `${where} ${position}`),
    );
    const match = declared.find(
      ([, candidate]) => JSON.stringify(candidate) === scheme,
    );
    if (match === undefined)
      fail(`${where} ${position} is not a declared security scheme.`);
    return match[0];
  });
  if (named.length === 0) fail(`${where} must name a security scheme.`);
  return named;
}

/** The messages of one operation and the direction its action states. */
function operationMessages(
  asyncapi: Json,
  name: string,
  value: unknown,
): {
  channel: string;
  direction: MessageDirection;
  messages: string[];
  schemes: string[];
} {
  const where = `the operation ${name}`;
  const operation = record(value, where);
  const action = operation.action;
  // The document describes the server, so the server receives what the
  // client sends and sends what the client receives.
  if (action !== 'send' && action !== 'receive')
    fail(`${where} action must be send or receive.`);
  const channel = channelOf(asyncapi, operation.channel, `${where} channel`);
  const messages = list(operation.messages, `${where} messages`).map(
    (entry, position) =>
      text(
        target(asyncapi, entry, `${where} message ${position}`).name,
        `${where} message ${position} name`,
      ),
  );
  return {
    channel,
    direction: action === 'receive' ? 'client' : 'server',
    messages,
    schemes: schemesOf(asyncapi, operation.security, `${where} security`),
  };
}

/**
 * Reads and checks the message contract.
 *
 * `asyncapi` is the bundled source of `asyncapi.yaml` and `openapi` is the
 * bundled source of `openapi.yaml`. Every disagreement stops generation.
 */
export function readMessageContract(
  asyncapi: Json,
  openapi: Json,
): MessageContract {
  if (asyncapi.asyncapi !== asyncApiVersion)
    fail(`the document must state AsyncAPI ${asyncApiVersion}.`);
  const version = text(record(asyncapi.info, 'info').version, 'info.version');
  assertSharedSchemas(asyncapi, openapi);
  const upgrades = upgradeOperations(openapi);

  const directions = new Map<string, Map<string, MessageDirection>>();
  const usedSchemes = new Set<string>();
  for (const [name, value] of Object.entries(
    record(asyncapi.operations, 'the operations'),
  )) {
    const read = operationMessages(asyncapi, name, value);
    for (const scheme of read.schemes) usedSchemes.add(scheme);
    const byMessage =
      directions.get(read.channel) ?? new Map<string, MessageDirection>();
    for (const message of read.messages) {
      if (byMessage.has(message))
        fail(`the message ${message} belongs to two operations.`);
      byMessage.set(message, read.direction);
    }
    directions.set(read.channel, byMessage);
  }
  for (const scheme of Object.keys(
    record(
      record(asyncapi.components ?? {}, 'the components').securitySchemes ?? {},
      'the security schemes',
    ),
  ))
    if (!usedSchemes.has(scheme))
      fail(`the security scheme ${scheme} serves no operation.`);

  const channels: ChannelEntry[] = [];
  const kinds = new Set<string>();
  for (const [name, value] of Object.entries(
    record(asyncapi.channels, 'the channels'),
  )) {
    const where = `the channel ${name}`;
    const channel = record(value, where);
    const address = text(channel.address, `${where} address`);
    const upgrade = upgrades.get(address);
    if (upgrade === undefined)
      fail(
        `${where} address ${address} is not the path of an HTTP upgrade operation.`,
      );
    upgrades.delete(address);
    const binding = record(
      record(channel.bindings, `${where} bindings`).ws,
      `${where} WebSocket binding`,
    );
    if (binding.method !== 'GET') fail(`${where} binding must use GET.`);
    const headers = record(binding.headers, `${where} binding headers`);
    if (
      !list(headers.required ?? [], `${where} headers`).includes(
        subprotocolHeader,
      )
    )
      fail(`${where} binding must require the ${subprotocolHeader} header.`);
    const subprotocolSchema = schemaName(
      record(headers.properties, `${where} header properties`)[
        subprotocolHeader
      ],
      `${where} subprotocol`,
    );
    if (subprotocolSchema !== upgrade.subprotocolSchema)
      fail(
        `${where} and the operation ${upgrade.id} name different subprotocol schemas.`,
      );
    const subprotocol = constantOf(
      openapi,
      subprotocolSchema,
      `${where} subprotocol`,
    );

    const byMessage =
      directions.get(name) ?? new Map<string, MessageDirection>();
    const messages: MessageEntry[] = [];
    for (const [key, messageValue] of Object.entries(
      record(channel.messages, `${where} messages`),
    )) {
      const at = `${where} message ${key}`;
      const message = target(asyncapi, messageValue, at);
      if (message.name !== key) fail(`${at} must be named ${key}.`);
      const schema = schemaName(message.payload, `${at} payload`);
      const kind = kindOf(asyncapi, schema, `${at} payload`);
      if (kind !== key) fail(`${at} payload kind must be ${key}.`);
      if (kinds.has(kind)) fail(`the kind ${kind} names two messages.`);
      kinds.add(kind);
      const direction = byMessage.get(key);
      if (direction === undefined)
        fail(`${at} belongs to no operation, so nothing sends it.`);
      byMessage.delete(key);
      messages.push({ kind, schema, direction });
    }
    for (const missing of byMessage.keys())
      fail(`an operation names ${missing}, which ${where} does not hold.`);
    messages.sort((left, right) => (left.kind < right.kind ? -1 : 1));
    channels.push({
      name,
      address,
      operationId: upgrade.id,
      subprotocol,
      messages,
    });
  }
  for (const [path, upgrade] of upgrades)
    fail(
      `the upgrade operation ${upgrade.id} at ${path} has no channel in asyncapi.yaml.`,
    );
  channels.sort((left, right) => (left.name < right.name ? -1 : 1));
  return { version, channels };
}
