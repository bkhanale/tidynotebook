/**
 * The one browser transport of the sync notice stream (records 0126, 0130).
 *
 * PartySocket owns the reconnects and the connection timeout. Its delays are
 * fixed numbers, so each transport draws its own minimum and maximum delay
 * inside a bound: many tabs that lost one server come back apart, and no
 * retry loop of this repository exists. The buffer of messages sent while
 * disconnected is off, because the coordinator sends the current set after
 * each `ready`, never a stale one. A policy close of the server, code 1008,
 * ends the reconnects.
 *
 * The address, the subprotocol and the frames come from the generated socket
 * entry, so this file names no path and writes no message of its own.
 */
import ReconnectingWebSocket from 'partysocket/ws';
import {
  readSyncNoticesMessage,
  syncNoticesAddress,
  syncNoticesProtocol,
  type SyncNoticesServerMessage,
} from './generated/socket.gen.ts';

/** The reconnect settings of one transport. */
export type ReconnectSettings = {
  readonly minReconnectionDelay: number;
  readonly maxReconnectionDelay: number;
  readonly reconnectionDelayGrowFactor: number;
  readonly minUptime: number;
  readonly connectionTimeout: number;
};

/**
 * Draws the reconnect settings of one transport.
 *
 * The first delay lies between one and two seconds and the longest between
 * thirty and sixty. Each failed try waits half as long again as the one
 * before, and a connection that stays up five seconds starts over.
 */
export function reconnectSettings(random: () => number): ReconnectSettings {
  return {
    minReconnectionDelay: Math.round(1_000 + 1_000 * random()),
    maxReconnectionDelay: Math.round(30_000 + 30_000 * random()),
    reconnectionDelayGrowFactor: 1.5,
    minUptime: 5_000,
    connectionTimeout: 10_000,
  };
}

/** The close code of a server that refuses the stream by policy. */
export const policyCloseCode = 1008;

/** What one transport tells its owner. */
export type SyncNoticesHandlers = {
  /** The connection opened, the first time or after a reconnect. */
  readonly onOpen: () => void;
  /** One frame: its message, or `null` for a frame outside the contract. */
  readonly onMessage: (message: SyncNoticesServerMessage | null) => void;
  /** The connection closed. The transport can open it again. */
  readonly onClose: () => void;
};

/** One open transport. */
export type SyncNoticesTransport = {
  /** Sends one frame now, or drops it while the connection is down. */
  readonly send: (text: string) => void;
  /** Closes the connection and ends every reconnect. */
  readonly close: () => void;
};

/** Opens the notice stream of one origin. */
export function connectSyncNotices(
  origin: string,
  handlers: SyncNoticesHandlers,
  options: {
    readonly random?: () => number;
    /** The socket class, which a test replaces with a fake. */
    readonly socketClass?: unknown;
  } = {},
): SyncNoticesTransport {
  const settings = reconnectSettings(options.random ?? Math.random);
  const socket = new ReconnectingWebSocket(
    syncNoticesAddress(origin),
    [syncNoticesProtocol],
    {
      ...settings,
      maxEnqueuedMessages: 0,
      shouldReconnectOnClose: (event) => event.code !== policyCloseCode,
      ...(options.socketClass === undefined
        ? {}
        : { WebSocket: options.socketClass }),
    },
  );
  socket.onopen = (): void => {
    handlers.onOpen();
  };
  socket.onmessage = (event: MessageEvent): void => {
    handlers.onMessage(
      typeof event.data === 'string'
        ? readSyncNoticesMessage(event.data)
        : null,
    );
  };
  socket.onclose = (): void => {
    handlers.onClose();
  };
  return {
    send: (text) => {
      if (socket.readyState === socket.OPEN) socket.send(text);
    },
    close: () => {
      socket.close();
    },
  };
}
