/**
 * The one mount of a WebSocket library on this server (records 0126 and 0129).
 *
 * `@fastify/websocket` upgrades a request that the router, the identity hook
 * and the contract checks have already served. This file is the only one that
 * imports it, and `tools/check-boundaries.mjs` holds that rule. Everything
 * past the upgrade reads a `StreamSocket`, so the gateway knows no library and
 * a unit test drives it with a fake.
 */
import type {
  FastifyContextConfig,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';

/** What a stream needs of one open socket. */
export type StreamSocket = {
  /** Sends one text frame. A socket that is closing drops it. */
  readonly send: (text: string) => void;
  /** Starts the closing handshake with one close code. */
  readonly close: (code: number) => void;
  /** Ends the connection at once, with no handshake. */
  readonly terminate: () => void;
  /** Sends one protocol Ping. */
  readonly ping: () => void;
  /** The bytes that wait to be written. */
  readonly bufferedBytes: () => number;
  /** Hears each frame: its text, or `null` for a binary frame. */
  readonly onMessage: (listener: (text: string | null) => void) => void;
  /** Hears each protocol Pong. */
  readonly onPong: (listener: () => void) => void;
  /** Hears the end of the connection, once. */
  readonly onClose: (listener: () => void) => void;
};

/** Wraps one socket of the library. */
function streamSocket(socket: WebSocket): StreamSocket {
  return {
    send: (text) => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(text, () => {
        // A write that failed ends the connection, which the close listener
        // reports. Nothing else waits for the write.
      });
    },
    close: (code) => {
      socket.close(code);
    },
    terminate: () => {
      socket.terminate();
    },
    ping: () => {
      if (socket.readyState === socket.OPEN) socket.ping();
    },
    bufferedBytes: () => socket.bufferedAmount,
    onMessage: (listener) => {
      socket.on('message', (data, isBinary) => {
        listener(
          isBinary ? null : Buffer.from(toBuffer(data)).toString('utf8'),
        );
      });
    },
    onPong: (listener) => {
      socket.on('pong', listener);
    },
    onClose: (listener) => {
      socket.once('close', listener);
    },
  };
}

/** The bytes of one received frame, whatever form the library gave. */
function toBuffer(data: Buffer | ArrayBuffer | readonly Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.concat([...data]);
}

/** The bounds that the library enforces for every socket of this server. */
export type WebSocketBounds = {
  /** The largest frame in bytes. A larger frame closes the socket. */
  readonly maxFrameBytes: number;
  /** The subprotocols that the contract names. */
  readonly subprotocols: readonly string[];
  /** Runs before the server closes, so a stream can stop in order. */
  readonly preClose: () => Promise<void>;
};

/** Registers the library once, before any route that upgrades. */
export async function registerWebSocket(
  app: FastifyInstance,
  bounds: WebSocketBounds,
): Promise<void> {
  await app.register(websocket, {
    options: {
      maxPayload: bounds.maxFrameBytes,
      // Notices are small, so compression costs memory and buys nothing.
      perMessageDeflate: false,
      // The contract check has already refused any other subprotocol, so
      // the server names the one that the client asked for.
      handleProtocols: (offered) =>
        [...offered].find((name) => bounds.subprotocols.includes(name)) ??
        false,
    },
    preClose: async function (this: FastifyInstance) {
      await bounds.preClose();
      for (const client of this.websocketServer.clients) client.terminate();
    },
  });
}

/** Whether the request asks for an upgrade that the library will perform. */
export function isUpgrade(request: FastifyRequest): boolean {
  return request.ws;
}

/** One route that answers HTTP and upgrades a WebSocket request. */
export type SocketRoute = {
  readonly url: string;
  readonly config: FastifyContextConfig;
  /** Runs before the upgrade. A reply sent here refuses the upgrade. */
  readonly preHandler: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>;
  /** Answers a request that asks for no upgrade. */
  readonly handler: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>;
  /** Takes the socket of an upgraded request. */
  readonly onSocket: (socket: StreamSocket, request: FastifyRequest) => void;
};

/** Mounts one socket route on a scope. */
export function mountSocketRoute(
  scope: FastifyInstance,
  route: SocketRoute,
): void {
  scope.route({
    method: 'GET',
    url: route.url,
    config: route.config,
    preHandler: route.preHandler,
    handler: route.handler,
    wsHandler: (socket, request) => {
      route.onSocket(streamSocket(socket), request);
    },
  });
}
