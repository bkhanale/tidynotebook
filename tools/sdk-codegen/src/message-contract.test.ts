/**
 * Checks of the message contract reader against the HTTP contract.
 *
 * The fixtures take the bundled form that the pinned Redocly CLI writes: a
 * schema stays a reference, and a channel, a message and a security scheme
 * are written in full where an operation names one.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readMessageContract } from './message-contract.ts';

type Json = Record<string, unknown>;

const scheme = { type: 'httpApiKey', in: 'cookie', name: 'session' };

const notice: Json = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id'],
  properties: {
    kind: { type: 'string', const: 'notice' },
    id: { type: 'string' },
  },
};

const schemas: Json = {
  Protocol: { type: 'string', const: 'demo.1' },
  Hello: {
    type: 'object',
    additionalProperties: false,
    required: ['kind'],
    properties: { kind: { type: 'string', const: 'hello' } },
  },
  Notice: notice,
};

function message(name: string, schema: string): Json {
  return { name, payload: { $ref: `#/components/schemas/${schema}` } };
}

function channel(): Json {
  return {
    address: '/api/demo',
    messages: {
      hello: message('hello', 'Hello'),
      notice: message('notice', 'Notice'),
    },
    bindings: {
      ws: {
        method: 'GET',
        headers: {
          type: 'object',
          required: ['sec-websocket-protocol'],
          properties: {
            'sec-websocket-protocol': {
              $ref: '#/components/schemas/Protocol',
            },
          },
        },
      },
    },
  };
}

/** A message contract in bundled form, with one message each way. */
function messages(): {
  asyncapi: string;
  info: Json;
  channels: Record<string, Json>;
  operations: Record<string, Json>;
  components: { securitySchemes: Json; schemas: Json };
} {
  return {
    asyncapi: '3.0.0',
    info: { version: '1.0.0' },
    channels: { demo: channel() },
    operations: {
      receiveHello: {
        action: 'receive',
        channel: channel(),
        security: [scheme],
        messages: [message('hello', 'Hello')],
      },
      sendNotice: {
        action: 'send',
        channel: channel(),
        security: [scheme],
        messages: [message('notice', 'Notice')],
      },
    },
    components: {
      securitySchemes: { session: scheme },
      schemas: structuredClone(schemas),
    },
  };
}

/** The HTTP contract with the upgrade operation of the channel. */
function http(): {
  paths: Record<string, Json>;
  components: { parameters: Json; schemas: Json };
} {
  return {
    paths: {
      '/api/demo': {
        get: {
          operationId: 'openDemo',
          parameters: [{ $ref: '#/components/parameters/DemoProtocol' }],
          responses: { '101': { description: 'Switched.' } },
        },
      },
    },
    components: {
      parameters: {
        DemoProtocol: {
          name: 'sec-websocket-protocol',
          in: 'header',
          required: true,
          schema: { $ref: '#/components/schemas/Protocol' },
        },
      },
      schemas: structuredClone(schemas),
    },
  };
}

await test('a consistent contract gives each message its kind and direction', () => {
  const contract = readMessageContract(messages(), http());
  assert.deepEqual(contract, {
    version: '1.0.0',
    channels: [
      {
        name: 'demo',
        address: '/api/demo',
        operationId: 'openDemo',
        subprotocol: 'demo.1',
        messages: [
          { kind: 'hello', schema: 'Hello', direction: 'client' },
          { kind: 'notice', schema: 'Notice', direction: 'server' },
        ],
      },
    ],
  });
});

/** Asserts that the reader refuses the documents with a matching message. */
function refuses(asyncapi: Json, openapi: Json, pattern: RegExp): void {
  assert.throws(() => readMessageContract(asyncapi, openapi), pattern);
}

await test('a channel address with no upgrade operation is refused', () => {
  const document = messages();
  const demo = document.channels.demo;
  assert.ok(demo !== undefined);
  demo.address = '/api/other';
  refuses(
    document,
    http(),
    /is not one channel|not the path of an HTTP upgrade/,
  );
});

await test('an upgrade operation with no channel is refused', () => {
  const openapi = http();
  openapi.paths['/api/second'] = {
    get: {
      operationId: 'openSecond',
      parameters: [{ $ref: '#/components/parameters/DemoProtocol' }],
      responses: { '101': { description: 'Switched.' } },
    },
  };
  refuses(messages(), openapi, /openSecond at \/api\/second has no channel/);
});

await test('two subprotocol schemas are refused', () => {
  const openapi = http();
  openapi.components.schemas.Other = { type: 'string', const: 'demo.1' };
  openapi.components.parameters.DemoProtocol = {
    name: 'sec-websocket-protocol',
    in: 'header',
    required: true,
    schema: { $ref: '#/components/schemas/Other' },
  };
  refuses(messages(), openapi, /name different subprotocol schemas/);
});

await test('a payload that the HTTP contract does not list is refused', () => {
  const openapi = http();
  delete openapi.components.schemas.Notice;
  refuses(messages(), openapi, /Notice is not listed in openapi.yaml/);
});

await test('a payload that differs between the two contracts is refused', () => {
  const document = messages();
  document.components.schemas.Notice = {
    ...structuredClone(notice),
    description: 'A copy.',
  };
  refuses(document, http(), /Notice differs between the two documents/);
});

await test('a payload without a kind constant is refused', () => {
  const broken: Json = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string' } },
  };
  const document = messages();
  document.components.schemas.Notice = broken;
  const openapi = http();
  openapi.components.schemas.Notice = broken;
  refuses(document, openapi, /must require kind/);
});

await test('a kind that differs from the message name is refused', () => {
  const document = messages();
  const demo = document.channels.demo;
  assert.ok(demo !== undefined);
  demo.messages = {
    hello: message('hello', 'Hello'),
    notice: message('notice', 'Hello'),
  };
  refuses(document, http(), /payload kind must be notice/);
});

await test('a message that no operation sends is refused', () => {
  const document = messages();
  delete document.operations.sendNotice;
  refuses(document, http(), /notice belongs to no operation/);
});

await test('an operation without a security scheme is refused', () => {
  const document = messages();
  const receive = document.operations.receiveHello;
  assert.ok(receive !== undefined);
  receive.security = [];
  refuses(document, http(), /must name a security scheme/);
});

await test('a security scheme that no operation names is refused', () => {
  const document = messages();
  document.components.securitySchemes.spare = {
    type: 'httpApiKey',
    in: 'cookie',
    name: 'spare',
  };
  refuses(document, http(), /spare serves no operation/);
});

await test('another AsyncAPI version is refused', () => {
  const document = messages();
  document.asyncapi = '2.6.0';
  refuses(document, http(), /must state AsyncAPI 3.0.0/);
});
