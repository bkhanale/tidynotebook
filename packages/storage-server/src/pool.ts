/**
 * The one way this server opens a PostgreSQL connection pool.
 *
 * A bare `pg.Pool` fails in two ways, and both reach the process.
 *
 * - When PostgreSQL ends an idle connection, for example on a restart, a
 *   failover or an operator command, the pool drops that client and emits
 *   `error`. An emitter with no `error` listener throws, so the whole server
 *   stopped on an event that the next query recovers from by itself.
 * - `end()` resolves as soon as it asks each client to close, before any
 *   socket has closed. A caller that then removed the database ended those
 *   sessions itself, and each client still closing raised that error.
 *
 * `openPool` answers both. The pool keeps a listener for the error of an idle
 * client, and its `end()` resolves only when every client it opened has
 * closed. Every pool of this server comes from here, so no pool can forget
 * either rule.
 */
import pg from 'pg';

/**
 * A pool whose `end()` waits for the close of every client.
 *
 * A client joins the open set when it connects and leaves it when its
 * connection ends, so a client that never connected is never waited for.
 */
class ClosingPool extends pg.Pool {
  readonly #open = new Set<pg.PoolClient>();

  constructor(config: pg.PoolConfig) {
    super(config);
    // The pool has already dropped the client, and the next checkout opens a
    // new one. A query that needs the database reports its own failure, so
    // nothing is lost here.
    this.on('error', () => {});
    this.on('connect', (client) => {
      this.#open.add(client);
      client.once('end', () => {
        this.#open.delete(client);
      });
    });
  }

  /** Waits until every client of this pool has closed its connection. */
  async #closed(): Promise<void> {
    await Promise.all(
      [...this.#open].map(
        (client) =>
          new Promise<void>((resolve) => {
            if (!this.#open.has(client)) resolve();
            else client.once('end', () => resolve());
          }),
      ),
    );
  }

  override end(): Promise<void>;
  override end(callback: () => void): void;
  override end(callback?: () => void): Promise<void> | void {
    const ended = super.end().then(() => this.#closed());
    if (callback === undefined) return ended;
    void ended.then(callback, callback);
  }
}

/**
 * The size of each pool of one server process.
 *
 * A pool that a caller opens with no size of its own takes its size here, so
 * the whole connection budget of a process is one sum. The load tool of the
 * sync notices holds that sum as its bound (issue 191).
 */
export const poolSizes = {
  identity: 10,
  content: 10,
  attachments: 10,
  coordination: 4,
  auth: 5,
  listener: 1,
} as const;

/** The most connections that one server process opens. */
export const processConnectionLimit = Object.values(poolSizes).reduce(
  (sum, size) => sum + size,
  0,
);

/** Opens one connection pool with the two rules of this module. */
export function openPool(config: pg.PoolConfig): pg.Pool {
  return new ClosingPool(config);
}
