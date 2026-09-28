import { definitionsId, type SharedContract } from './definitions.ts';
import type { MessageContract } from './message-contract.ts';

const header = (source: string) =>
  [
    '/*',
    ` * Generated from ${source} by tools/sdk-codegen.`,
    ' * Do not edit by hand. Run `pnpm generate` after a contract change.',
    ' */',
    '',
  ].join('\n');

const literal = (value: unknown) => JSON.stringify(value, null, 2);

/** Runtime operation index. Pure data plus the types that describe it. */
export function emitContractModule(shared: SharedContract): string {
  const { definitions, index, channels } = shared;
  const ids = index.operations.map((operation) => operation.id);
  const channelIds = channels.map((channel) => channel.name);
  const kinds = (direction: 'client' | 'server'): string[] =>
    channels.flatMap((channel) =>
      channel.messages
        .filter((message) => message.direction === direction)
        .map((message) => message.kind),
    );
  const union = (values: readonly string[]): string =>
    values.length === 0
      ? 'never'
      : values.map((value) => `'${value}'`).join(' | ');
  return `${header('packages/api-contract/openapi.yaml')}
import type { SchemaObject } from 'ajv';

/** Every operation id declared by the contract. */
export type OperationId =
${ids.map((id) => `  | '${id}'`).join('\n')};

export type HttpMethod =
  | 'get'
  | 'put'
  | 'post'
  | 'delete'
  | 'options'
  | 'head'
  | 'patch'
  | 'trace';

/** A JSON Schema 2020-12 object that Ajv can compile. */
export type JsonSchema = SchemaObject;

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

/** Explicit serialization of one parameter, copied from the contract. */
export type ParameterSerialization = {
  readonly name: string;
  readonly location: ParameterLocation;
  readonly required: boolean;
  readonly style: string;
  readonly explode: boolean;
};

/**
 * One schema for each request slot. The path, query, and header schemas always
 * exist. A closed empty object schema means the operation accepts no member of
 * that kind, so an unknown one is rejected. A null body means the operation
 * accepts no request body at all.
 */
export type RequestSchemas = {
  readonly params: JsonSchema;
  readonly query: JsonSchema;
  readonly headers: JsonSchema;
  readonly body: JsonSchema | null;
  readonly bodyMediaType: string | null;
};

/** One security requirement: scheme name to the scopes it must carry. */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

export type ResponseSchema = {
  readonly status: number;
  readonly mediaType: string;
  readonly schema: JsonSchema;
};

export type OperationEntry = {
  readonly id: OperationId;
  readonly method: HttpMethod;
  readonly path: string;
  /**
   * The protocol library that serves this operation, or null.
   *
   * A protocol operation is implemented by a maintained library rather than by
   * a contract handler. The server registers it through that adapter's exact
   * path list and leaves it out of the one-handler-per-operation check.
   */
  readonly protocol: string | null;
  /** Alternative security requirements. An empty list means public. */
  readonly security: readonly SecurityRequirement[];
  readonly parameters: readonly ParameterSerialization[];
  readonly request: RequestSchemas;
  readonly responses: readonly ResponseSchema[];
  /**
   * Statuses that the operation declares without a response body, such as a
   * 304. The boundary permits an empty answer only for these.
   */
  readonly noContent: readonly number[];
};

/** Version of the contract document that produced this index. */
export const contractVersion = '${index.version}';

/**
 * The schemas that more than one operation slot states.
 *
 * Every schema below is written once here and pointed at from each slot that
 * uses it, so the contract is not copied per operation. A consumer that
 * compiles a slot schema must register this document first; see
 * \`packages/api-contract/src/validators.ts\`.
 */
export const sharedDefinitions: JsonSchema = ${literal({ $id: definitionsId, $defs: definitions })};

export const operations: readonly OperationEntry[] = ${literal(index.operations)};

/** Every channel of \`packages/api-contract/asyncapi.yaml\`. */
export type ChannelId = ${union(channelIds)};

/** Who sends a message: the browser or the server. */
export type MessageDirection = 'client' | 'server';

/** The kind of every message that a client sends. */
export type ClientMessageKind = ${union(kinds('client'))};

/** The kind of every message that the server sends. */
export type ServerMessageKind = ${union(kinds('server'))};

/** One message of a channel and the schema of its payload. */
export type MessageEntry = {
  /** The value of the \`kind\` member, which names the message. */
  readonly kind: ClientMessageKind | ServerMessageKind;
  readonly direction: MessageDirection;
  readonly schema: JsonSchema;
};

/** One WebSocket channel and the HTTP upgrade operation that opens it. */
export type ChannelEntry = {
  readonly id: ChannelId;
  readonly address: string;
  readonly operationId: OperationId;
  /** The one WebSocket subprotocol of the channel. */
  readonly subprotocol: string;
  readonly messages: readonly MessageEntry[];
};

export const channels: readonly ChannelEntry[] = ${literal(
    channels.map((channel) => ({
      id: channel.name,
      address: channel.address,
      operationId: channel.operationId,
      subprotocol: channel.subprotocol,
      messages: channel.messages,
    })),
  )};
`;
}

/** The name of a channel with its first letter in capitals. */
function capitalized(name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * The client entry of every WebSocket channel.
 *
 * It states the address and the subprotocol of each channel, the union type of
 * the messages of each direction, and the only way a client turns a message
 * into a frame or a frame into a message. The payload types are the ones that
 * Hey API wrote from the same schema components. A received frame is checked
 * by its kind only: the server validates every message it sends against the
 * full schema, as it validates every HTTP answer.
 */
export function emitSocketModule(contract: MessageContract): string {
  const imports = contract.channels
    .flatMap((channel) => channel.messages.map((message) => message.schema))
    .sort();
  const sections = contract.channels.map((channel) => {
    const name = capitalized(channel.name);
    const client = channel.messages.filter(
      (message) => message.direction === 'client',
    );
    const server = channel.messages.filter(
      (message) => message.direction === 'server',
    );
    const types = (list: typeof client): string =>
      list.length === 0
        ? 'never'
        : list.map((message) => message.schema).join(' | ');
    return `/** The address of the ${channel.name} channel, from the upgrade ${channel.operationId}. */
export const ${channel.name}Path = '${channel.address}';

/** The one WebSocket subprotocol of the ${channel.name} channel. */
export const ${channel.name}Protocol = '${channel.subprotocol}';

/** Every message that a client sends on the ${channel.name} channel. */
export type ${name}ClientMessage = ${types(client)};

/** Every message that the server sends on the ${channel.name} channel. */
export type ${name}ServerMessage = ${types(server)};

const ${channel.name}ServerKinds: readonly string[] = ${JSON.stringify(
      server.map((message) => message.kind),
    )};

/**
 * The WebSocket address of the ${channel.name} channel on one origin.
 *
 * An https origin gives a wss address and an http origin gives a ws address.
 */
export function ${channel.name}Address(origin: string): string {
  const address = new URL(${channel.name}Path, origin);
  address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
  return address.toString();
}

/** The frame text of one client message of the ${channel.name} channel. */
export function encode${name}Message(message: ${name}ClientMessage): string {
  return JSON.stringify(message);
}

function is${name}ServerMessage(value: unknown): value is ${name}ServerMessage {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const kind: unknown = Object.fromEntries(Object.entries(value)).kind;
  return typeof kind === 'string' && ${channel.name}ServerKinds.includes(kind);
}

/**
 * The server message of one frame of the ${channel.name} channel, or \`null\`.
 *
 * A frame that is not JSON, or that names no server message, answers
 * \`null\`, and the caller treats the stream as broken.
 */
export function read${name}Message(frame: string): ${name}ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(frame);
  } catch {
    return null;
  }
  return is${name}ServerMessage(value) ? value : null;
}
`;
  });
  return `${header('packages/api-contract/asyncapi.yaml')}
import type {
${imports.map((name) => `  ${name},`).join('\n')}
} from './types.gen.js';

${sections.join('\n')}`;
}
