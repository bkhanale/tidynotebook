/**
 * The one write of the published boundary: a password becomes a ticket.
 *
 * Every other call of the reader path reads, and `publication-transaction.ts`
 * marks its transaction read only for that reason. The unlock is the one
 * exception, so it is one file, one function, and one statement that writes.
 *
 * The password digest never leaves this package. The lookup function of the
 * migration answers that a password guards the link and never the digest of
 * it, so this call reads the digest itself, after it adopted the owner of that
 * one link, and it hands the value to the `verify` callback of the caller. The
 * caller is the hasher adapter of `apps/server`, which answers true or false
 * and learns nothing else. No method of this package answers a password digest
 * to a route.
 *
 * The rules come from `packages/core` and are not repeated here.
 * `linkRefusalCause` states what a stopped link is, and `readingTicketExpiry`
 * states how long the ticket lives. The expiry is written into the row, so a
 * later read of that row can never compute a longer life, which is the rule of
 * decision 0030 that the runtime role also holds: it has no UPDATE right on a
 * reading ticket.
 *
 * Every failure answers a cause for the operator log of decision 0020 and
 * nothing else. The caller turns every cause into the one refusal of the
 * reader path.
 */
import type pg from 'pg';
import {
  OperationalError,
  linkRefusalCause,
  readingTicketExpiry,
  type ReaderRefusalCause,
  type ReadingTicket,
} from '@notesapp/core';
import { isSecretDigest, parsePublicationRow } from './publication-row.ts';
import type { PublicationLookupRow } from './publication-row.ts';
import {
  assertUuid,
  operational,
  postgresFailure,
  unreachable,
} from './errors.ts';

/** What one unlock attempt carries. */
export type PublicationUnlockAttempt = {
  /** The digest of the token that the address named. */
  readonly tokenDigest: string;
  /** The digest of the ticket that the caller drew for this attempt. */
  readonly ticketDigest: string;
  /** The instant of the attempt, which decides the life of the ticket. */
  readonly now: Date;
  /**
   * Answers whether the password of the reader matches the stored value.
   *
   * The stored value is the slow salted hash of the account path. The callback
   * receives it, answers a boolean, and keeps nothing.
   */
  readonly verify: (passwordDigest: string) => Promise<boolean>;
};

/** What one unlock attempt produced. */
export type PublicationUnlockResult =
  | { readonly ok: true; readonly ticket: ReadingTicket }
  | { readonly ok: false; readonly cause: ReaderRefusalCause };

/** One refused attempt, with the cause that the operator log keeps. */
function refuse(cause: ReaderRefusalCause): PublicationUnlockResult {
  return { ok: false, cause };
}

/**
 * Gives one reading ticket to a reader that gave the password of a link.
 *
 * The call opens its own transaction, because the reader transaction is read
 * only and no port of `packages/core` declares a write. It adopts the owner of
 * the link that the token digest opened, so the row policies bind the read of
 * the password digest and the write of the ticket to that one account.
 */
export async function unlockPublication(
  pool: pg.Pool,
  attempt: PublicationUnlockAttempt,
): Promise<PublicationUnlockResult> {
  // A digest of another shape is at rest nowhere, because both digest columns
  // carry the same rule as a check constraint.
  if (!isSecretDigest(attempt.tokenDigest)) return refuse('unknown');
  if (!isSecretDigest(attempt.ticketDigest)) {
    throw new OperationalError(
      'unexpected',
      'notesapp: a reading ticket is stored as a digest and never as a ticket.',
    );
  }
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw unreachable(error);
  }
  try {
    await client.query('begin');
    try {
      const result = await attemptUnlock(client, attempt);
      await client.query('commit');
      return result;
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

/** The body of one attempt, inside an open transaction. */
async function attemptUnlock(
  client: pg.PoolClient,
  attempt: PublicationUnlockAttempt,
): Promise<PublicationUnlockResult> {
  const answer = await client.query<PublicationLookupRow>(
    'select * from public.notesapp_publication_by_token($1)',
    [attempt.tokenDigest],
  );
  const row = answer.rows[0];
  if (row === undefined) return refuse('unknown');
  const open = parsePublicationRow(row);
  const stopped = linkRefusalCause(open.link, attempt.now.getTime());
  if (stopped !== null) return refuse(stopped);
  // A link with no password gives no ticket. A reader of such a link needs
  // none, so an unlock of one is an attempt that learns nothing.
  if (!open.link.passwordProtected) return refuse('locked');
  assertUuid(open.ownerAccountId, 'the owner of a published link');
  await client.query("select set_config('notesapp.account_id', $1, true)", [
    open.ownerAccountId,
  ]);
  const stored = await client.query<{ password_digest: string | null }>(
    'select password_digest from public.publications where workspace_id = $1 and id = $2',
    [open.link.workspaceId, open.link.publicationId],
  );
  const digest = stored.rows[0]?.password_digest ?? null;
  if (digest === null) return refuse('locked');
  if (!(await attempt.verify(digest))) return refuse('locked');
  const issuedAt = attempt.now.toISOString();
  const expiresAt = readingTicketExpiry(issuedAt);
  if (expiresAt === null) {
    throw new OperationalError(
      'unexpected',
      'notesapp: the instant of an unlock is not an instant.',
    );
  }
  await client.query(
    `insert into public.reading_tickets
        (ticket_digest, workspace_id, publication_id, issued_at, expires_at)
      values ($1, $2, $3, $4, $5)`,
    [
      attempt.ticketDigest,
      open.link.workspaceId,
      open.link.publicationId,
      issuedAt,
      expiresAt,
    ],
  );
  return {
    ok: true,
    ticket: {
      publicationId: open.link.publicationId,
      issuedAt,
      expiresAt,
    },
  };
}
