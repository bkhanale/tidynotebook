/**
 * The test client of the sync notice stream.
 *
 * A browser opens the stream through the generated socket entry and a
 * reconnecting library (plan 016, item 3). A test has no browser, so this one
 * file opens a socket with the `ws` library, from the address, the
 * subprotocol, and the frame functions of the generated entry.
 * `tools/check-boundaries.mjs` names it as the one test file that may import a
 * socket library. Every wait here ends on an event, never on a delay.
 */
import SocketClient from 'ws';
import {
  encodeSyncNoticesMessage,
  readSyncNoticesMessage,
  syncNoticesAddress,
  syncNoticesProtocol,
  type SyncNoticesClientMessage,
  type SyncNoticesServerMessage,
} from '@notesapp/api-client';

/** One open stream of a test. */
export type TestStream = {
  /** Every server message so far, in order. */
  readonly messages: readonly SyncNoticesServerMessage[];
  /** Waits for the first message from now on, or before, that matches. */
  readonly waitFor: (
    match: (message: SyncNoticesServerMessage) => boolean,
  ) => Promise<SyncNoticesServerMessage>;
  /** Sends one client message. */
  readonly send: (message: SyncNoticesClientMessage) => void;
  /** Sends one raw text frame, which may be outside the contract. */
  readonly sendRaw: (text: string) => void;
  /** Resolves with the close code when the server or the test closes it. */
  readonly closed: Promise<number>;
  /** Closes the stream from the client. */
  readonly close: () => void;
};

/** The answer to one upgrade: a stream, or the HTTP status of the refusal. */
export type TestUpgrade =
  | { readonly opened: true; readonly stream: TestStream }
  | { readonly opened: false; readonly status: number };

/** Opens one stream with a session cookie and an origin header. */
export function openTestStream(
  baseUrl: string,
  headers: { readonly cookie?: string; readonly origin?: string },
  protocol: string = syncNoticesProtocol,
): Promise<TestUpgrade> {
  return new Promise((resolve, reject) => {
    const socket = new SocketClient(syncNoticesAddress(baseUrl), [protocol], {
      headers: {
        ...(headers.cookie === undefined ? {} : { cookie: headers.cookie }),
        ...(headers.origin === undefined ? {} : { origin: headers.origin }),
      },
    });
    const messages: SyncNoticesServerMessage[] = [];
    const waiters: {
      readonly match: (message: SyncNoticesServerMessage) => boolean;
      readonly resolve: (message: SyncNoticesServerMessage) => void;
    }[] = [];
    let closedWith: (code: number) => void = () => {};
    const closed = new Promise<number>((done) => {
      closedWith = done;
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      const message = readSyncNoticesMessage(bytes.toString('utf8'));
      if (message === null) return;
      messages.push(message);
      for (const waiter of [...waiters])
        if (waiter.match(message)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
    });
    socket.on('close', (code) => {
      closedWith(code);
    });
    socket.on('unexpected-response', (_request, response) => {
      resolve({ opened: false, status: response.statusCode ?? 0 });
      socket.terminate();
    });
    socket.on('error', (error) => {
      reject(error);
    });
    socket.on('open', () => {
      resolve({
        opened: true,
        stream: {
          messages,
          waitFor: (match) => {
            const found = messages.find(match);
            if (found !== undefined) return Promise.resolve(found);
            return new Promise((done) => {
              waiters.push({ match, resolve: done });
            });
          },
          send: (message) => {
            socket.send(encodeSyncNoticesMessage(message));
          },
          sendRaw: (text) => {
            socket.send(text);
          },
          closed,
          close: () => {
            socket.close();
          },
        },
      });
    });
  });
}

/** Opens a stream that a test expects to open. */
export async function openStream(
  baseUrl: string,
  headers: { readonly cookie?: string; readonly origin?: string },
): Promise<TestStream> {
  const upgrade = await openTestStream(baseUrl, headers);
  if (!upgrade.opened)
    throw new Error(`The stream was refused with ${String(upgrade.status)}.`);
  return upgrade.stream;
}

/**
 * A socket class for the browser transport that sends a cookie and an origin.
 *
 * PartySocket builds its socket from the address and the subprotocol only,
 * and a browser adds the cookie and the origin by itself. Node adds neither,
 * so this class adds them, and the rest of the transport runs as it does in
 * a browser.
 */
export function socketClassWith(headers: {
  readonly cookie: string;
  readonly origin: string;
}): unknown {
  return class extends SocketClient {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { ...headers } });
    }
  };
}
