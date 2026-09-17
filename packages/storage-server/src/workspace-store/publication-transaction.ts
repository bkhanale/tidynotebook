/**
 * The unit of work of the reader path.
 *
 * This is refusal 4 of decision 0031. One call opens one transaction and marks
 * it `READ ONLY`, so PostgreSQL itself refuses a write when every layer above
 * has failed. The three differences from `transaction.ts` are deliberate:
 *
 * - It takes no `Actor`. A reader has no account, and an `Actor` is the value
 *   that every write use case needs, so this path never holds one.
 * - It starts with no identity at all, so every row policy hides every row
 *   from it. The repository adopts the owner account of the one link that the
 *   token digest opened, and that identity lasts for this transaction only.
 * - It takes no workspace lock. The lock orders the writes of one workspace,
 *   and this transaction writes nothing.
 *
 * The transaction commits when the callback returns. A read-only transaction
 * commits nothing, so the commit only releases the snapshot.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { OperationalError } from '@notesapp/core';
import {
  assertUuid,
  operational,
  postgresFailure,
  unreachable,
} from './errors.ts';

/** The SQLSTATE that PostgreSQL answers for a write in a read-only transaction. */
export const readOnlyTransactionCode = '25006';

/** What one open publication transaction hands to its repository. */
export type PublicationSession = {
  readonly client: pg.PoolClient;
  readonly db: NodePgDatabase;
  /**
   * Sets the owner account of the opened link as the identity of this
   * transaction.
   *
   * The setting is transaction local, so it disappears at commit or rollback
   * and cannot reach the next user of a pooled connection. One transaction
   * opens one link, so a second account is a defect of the caller and is
   * refused.
   */
  adoptOwner(accountId: string): Promise<void>;
};

/** Builds the repository of the reader path over one open transaction. */
export type PublicationBuilder<Built> = (session: PublicationSession) => Built;

/** Opens the session over one connection that already holds a transaction. */
function openSession(client: pg.PoolClient): PublicationSession {
  let owner: string | null = null;
  return {
    client,
    db: drizzle({ client }),
    async adoptOwner(accountId: string): Promise<void> {
      assertUuid(accountId, 'the owner of a published link');
      if (owner === accountId) return;
      if (owner !== null) {
        throw new OperationalError(
          'unexpected',
          'notesapp: one published read opens one link, so it adopts one owner.',
        );
      }
      await client.query("select set_config('notesapp.account_id', $1, true)", [
        accountId,
      ]);
      owner = accountId;
    },
  };
}

/**
 * Runs `run` inside one read-only transaction over a pooled connection.
 *
 * A failure of the callback rolls the transaction back. A database failure
 * becomes an infrastructure failure, and every other thrown value travels
 * unchanged, so the use case above this port keeps its own error type.
 */
export async function runPublicationRead<Built, T>(
  pool: pg.Pool,
  run: (built: Built) => Promise<T>,
  build: PublicationBuilder<Built>,
): Promise<T> {
  // A refused connection must not escape as a driver error: its message
  // repeats the host, the port, and the role of the connection URL.
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw unreachable(error);
  }
  try {
    await client.query('begin');
    try {
      await client.query('set transaction read only');
      const value = await run(build(openSession(client)));
      await client.query('commit');
      return value;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // The connection is already unusable; report the first failure.
      }
      if (error instanceof OperationalError) throw error;
      if (postgresFailure(error) !== null) throw operational(error);
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
 * Attempts one genuine write inside the read-only transaction and answers the
 * SQLSTATE of the refusal.
 *
 * A guarantee that no test can see is a comment, so this call makes refusal 4
 * of decision 0031 observable, as `readPooledIdentity` makes the absence of an
 * identity leak observable. `tests/integration/publications.test.ts` compares
 * the answer with `readOnlyTransactionCode`.
 *
 * The statement can never leave a row behind. PostgreSQL refuses a write in a
 * read-only transaction before it executes the statement; a transaction that
 * was not read only would still fail the foreign key of the named link, and a
 * transaction that held both would still fail the row policy, because this
 * call adopts no owner. An accepted write is therefore a broken boundary, and
 * the call throws and rolls the transaction back.
 */
export async function probePublicationWrite(
  pool: pg.Pool,
  attempt: {
    readonly ticketDigest: string;
    readonly workspaceId: string;
    readonly publicationId: string;
  },
): Promise<string> {
  return runPublicationRead<PublicationSession, string>(
    pool,
    async (session) => {
      try {
        await session.client.query(
          `insert into public.reading_tickets
              (ticket_digest, workspace_id, publication_id, expires_at)
            values ($1, $2, $3, now())`,
          [attempt.ticketDigest, attempt.workspaceId, attempt.publicationId],
        );
      } catch (error) {
        const failure = postgresFailure(error);
        if (failure === null) throw operational(error);
        return failure.code;
      }
      throw new OperationalError(
        'unexpected',
        'notesapp: the publication transaction accepted a write.',
      );
    },
    (session) => session,
  );
}
