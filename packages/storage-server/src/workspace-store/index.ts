/**
 * The composition root of the PostgreSQL workspace store.
 *
 * This module owns the connection pool and assembles the repositories over the
 * unit of work in `transaction.ts`. Each repository holds the SQL of one
 * context and implements its slice of the port; `createTransaction` spreads
 * them into the one `WorkspaceTransaction` that the unit of work hands to a
 * callback. The store keeps the same public surface as before the split.
 *
 * One call to `transact` opens one database transaction. It sets the actor
 * identity for that transaction only, then locks the workspace row, so the
 * commit ordered cursor cannot skip a transaction that commits late. `accept`
 * performs the atomic write inside a savepoint, so an expected domain failure
 * leaves the open transaction usable and writes nothing.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type {
  Actor,
  TransactOptions,
  WorkspaceStore,
  WorkspaceTransaction,
} from '@notesapp/core';
import { runSyncCleanup } from '../snapshots.ts';
import { operational } from './errors.ts';
import { runTransaction } from './transaction.ts';
import { membershipRepository } from './membership-repository.ts';
import { notesRepository } from './notes-repository.ts';
import { historyRepository } from './history-repository.ts';
import { trashRepository } from './trash-repository.ts';
import { searchRepository } from './search-repository.ts';
import { syncRepository } from './sync-repository.ts';

export { DatabaseFailure, WorkspaceUnavailableError } from './errors.ts';

/**
 * What one readiness read learns about the database behind the pool.
 *
 * The read answers instead of throwing, because an unreachable database is a
 * readiness answer and not a fault of the caller.
 */
export type DatabaseProbeResult = {
  /** True when a pooled connection answered a trivial statement. */
  readonly reachable: boolean;
  /**
   * The number of applied migrations, or `null` when the database gave no
   * answer. A reachable database with no answer has no migrated schema.
   */
  readonly schemaVersion: number | null;
};

/** Options of one storage pool. */
export type WorkspaceStoreOptions = {
  /** Maximum pooled connections. A test uses one to reuse one connection. */
  readonly poolSize?: number;
  /** Statement timeout of every pooled connection, in milliseconds. */
  readonly statementTimeoutMs?: number;
};

/** A workspace store and the calls that a process needs to manage its pool. */
export type WorkspaceStoreHandle = WorkspaceStore & {
  /**
   * Removes expired snapshots and change records older than the retention.
   *
   * Revisions, contents, receipts, and purge markers are left alone, so saved
   * history stays valid beyond the event window. Returns how many snapshot
   * rows and change rows were removed.
   */
  cleanupSync(now: Date): Promise<{
    expiredSnapshots: number;
    oldChanges: number;
  }>;
  /**
   * The identity setting of one pooled connection outside a transaction.
   *
   * The value must be `null`. The transaction identity is set with the local
   * flag of `set_config`, so it disappears at commit or rollback and cannot
   * reach the next user of the connection.
   *
   * The call takes whichever connection the pool hands out, so it proves the
   * absence of a leak only at pool size 1, where that is the connection the
   * earlier transaction used.
   */
  readPooledIdentity(): Promise<string | null>;
  /**
   * Reads the state of the database through one pooled connection.
   *
   * The readiness probe of the server calls it on every probe request, so it
   * borrows a connection from the pool that already serves the workspace
   * traffic and opens none of its own. It runs a trivial statement, so a pool
   * that hands over a connection cannot report a database that answers
   * nothing.
   */
  probeDatabase(): Promise<DatabaseProbeResult>;
  /** Closes every pooled connection. */
  close(): Promise<void>;
};

/** The answer of a read that no pooled connection could complete. */
const unreachableDatabase: DatabaseProbeResult = {
  reachable: false,
  schemaVersion: null,
};

/** Builds the port implementation over one open transaction. */
function createTransaction(
  client: pg.PoolClient,
  db: NodePgDatabase,
  actor: Actor,
  workspaceId: string,
): WorkspaceTransaction {
  const context = { client, db, actor, workspaceId };
  return {
    ...membershipRepository(context),
    ...notesRepository(context),
    ...historyRepository(context),
    ...trashRepository(context),
    ...searchRepository(context),
    ...syncRepository(context),
  };
}

/** Opens a workspace store over one PostgreSQL connection pool. */
export function openWorkspaceStore(
  databaseUrl: string,
  options: WorkspaceStoreOptions = {},
): WorkspaceStoreHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.poolSize ?? 10,
    ...(options.statementTimeoutMs === undefined
      ? {}
      : { statement_timeout: options.statementTimeoutMs }),
  });

  return {
    async transact<T>(
      actor: Actor,
      workspaceId: string,
      run: (tx: WorkspaceTransaction) => Promise<T>,
      options: TransactOptions = {},
    ): Promise<T> {
      return runTransaction(
        pool,
        actor,
        workspaceId,
        run,
        options,
        createTransaction,
      );
    },

    async cleanupSync(
      now: Date,
    ): Promise<{ expiredSnapshots: number; oldChanges: number }> {
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        throw operational(error);
      }
      try {
        return await runSyncCleanup(client, now);
      } catch (error) {
        throw operational(error);
      } finally {
        client.release();
      }
    },

    async readPooledIdentity(): Promise<string | null> {
      const client = await pool.connect();
      try {
        const result = await client.query<{ value: string | null }>(
          "select nullif(current_setting('notesapp.account_id', true), '') as value",
        );
        return result.rows[0]?.value ?? null;
      } finally {
        client.release();
      }
    },

    async probeDatabase(): Promise<DatabaseProbeResult> {
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch {
        return unreachableDatabase;
      }
      try {
        await client.query('select 1');
      } catch {
        // A connection that cannot answer this must not go back to the pool,
        // so the probe destroys it and the next caller gets a new one.
        client.release(true);
        return unreachableDatabase;
      }
      try {
        const result = await client.query<{ version: number }>(
          'select public.notesapp_schema_version() as version',
        );
        return { reachable: true, schemaVersion: result.rows[0]?.version ?? 0 };
      } catch {
        // The database answers, so it is reachable. It reports no version,
        // which the migration check reads as an unmigrated schema.
        return { reachable: true, schemaVersion: null };
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
