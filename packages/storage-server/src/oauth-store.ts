/** Identity persistence and request transactions for the OAuth provider (0226). */
import type pg from 'pg';
import {
  OperationalError,
  maxOAuthClients,
  oauthGrantCountAllowed,
  type ControlStanding,
} from '@notesapp/core';

export const oauthLockTimeoutMs = 2000;
export const oauthStatementTimeoutMs = 5000;

/** A consent refusal uses one fixed marker through a wrapped driver fault. */
export function isOAuthGrantLimit(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current === null || typeof current !== 'object') return false;
    if (
      'code' in current &&
      current.code === 'P0001' &&
      'message' in current &&
      current.message === 'oauth_grant_limit'
    )
      return true;
    if (!('cause' in current)) return false;
    current = current.cause;
  }
  return false;
}

/** The consent transaction holds the pair before it checks room. */
export async function oauthGrantRoom(
  client: pg.PoolClient,
  clientId: string,
  userId: string,
): Promise<boolean> {
  const rows = await client.query<{ count: number; existing: boolean }>(
    `select count(*)::int as count, coalesce(bool_or(client_id = $1), false) as existing
      from auth_oauth_consent where user_id = $2`,
    [clientId, userId],
  );
  const row = rows.rows[0];
  return row !== undefined && oauthGrantCountAllowed(row.count, row.existing);
}

/** Consent uses stored client metadata. It never fetches a missing client. */
export async function oauthConsentClientExists(
  client: pg.PoolClient,
  clientId: string,
): Promise<boolean> {
  const rows = await client.query<{ present: boolean }>(
    'select exists(select 1 from auth_oauth_client where client_id=$1) as present',
    [clientId],
  );
  return rows.rows[0]?.present === true;
}

export type OAuthTokenLocator = {
  readonly digest: string;
  readonly kind: 'authorization_code' | 'token';
  readonly hint?: string;
};
type Pair = { client_id: string; user_id: string };

/** Finds a pair without granting access. The request reads it again under its lock. */
async function tokenPair(
  client: pg.Pool | pg.PoolClient,
  locator: OAuthTokenLocator,
): Promise<Pair | null> {
  if (locator.kind === 'authorization_code') {
    const rows = await client.query<Pair>(
      `select (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->'query'->>'client_id' as client_id,
      (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->>'userId' as user_id from auth_verification
      where identifier = $1 and value like '{%' and (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->>'type' = 'authorization_code'
      union all select client_id, user_id from auth_oauth_access_token where authorization_code_id = $1
      union all select client_id, user_id from auth_oauth_refresh_token where authorization_code_id = $1 limit 1`,
      [locator.digest],
    );
    return rows.rows[0] ?? null;
  }
  const first =
    locator.hint === 'access_token'
      ? 'auth_oauth_access_token'
      : 'auth_oauth_refresh_token';
  const second =
    locator.hint === 'access_token'
      ? 'auth_oauth_refresh_token'
      : 'auth_oauth_access_token';
  const rows = await client.query<Pair>(
    `select client_id, user_id from ${first} where token = $1
    union all select client_id, user_id from ${second} where token = $1 limit 1`,
    [locator.digest],
  );
  return rows.rows[0] ?? null;
}

/** Drizzle wraps driver faults. A bounded walk also refuses a cyclic cause chain. */
function timeout(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current === null || typeof current !== 'object') return false;
    if (
      'code' in current &&
      (current.code === '55P03' || current.code === '57014')
    )
      return true;
    if (!('cause' in current)) return false;
    current = current.cause;
  }
  return false;
}

/** A refusal returns normally and commits. A fault rolls back the whole request. */
export async function oauthRequestTransaction<T>(
  pool: pg.Pool,
  locator: OAuthTokenLocator | null,
  run: (client: pg.PoolClient, accountAllowed: boolean) => Promise<T>,
  commitWhen: (value: T) => boolean = () => true,
): Promise<T> {
  const pair = locator === null ? null : await tokenPair(pool, locator);
  return oauthPairTransaction(pool, pair, locator, run, commitWhen);
}

/** The verified session selects the account. The provider still verifies its query. */
export function oauthConsentTransaction<T>(
  pool: pg.Pool,
  clientId: string,
  userId: string,
  run: (client: pg.PoolClient) => Promise<T>,
  accepted: (value: T) => boolean,
): Promise<T> {
  return oauthPairTransaction(
    pool,
    { client_id: clientId, user_id: userId },
    null,
    (client) => run(client),
    () => true,
    (value) => !accepted(value),
  );
}

async function oauthPairTransaction<T>(
  pool: pg.Pool,
  pair: Pair | null,
  locator: OAuthTokenLocator | null,
  run: (client: pg.PoolClient, accountAllowed: boolean) => Promise<T>,
  commitWhen: (value: T) => boolean,
  rollbackWhen: (value: T) => boolean = () => false,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `set local lock_timeout = '${String(oauthLockTimeoutMs)}ms'`,
    );
    await client.query(
      `set local statement_timeout = '${String(oauthStatementTimeoutMs)}ms'`,
    );
    let allowed = true;
    if (pair !== null) {
      await client.query('select notesapp_oauth_lock_pair($1, $2)', [
        pair.client_id,
        pair.user_id,
      ]);
      const current =
        locator === null ? pair : await tokenPair(client, locator);
      const active = await client.query<{ allowed: boolean }>(
        'select notesapp_oauth_grant_allowed($1,$2) as allowed',
        [pair.client_id, pair.user_id],
      );
      allowed = current !== null && active.rows[0]?.allowed === true;
    }
    const value = await run(client, allowed);
    // A driver failure caught by the library must still abort this request.
    await client.query('select 1');
    if (!commitWhen(value))
      throw new OperationalError(
        'unexpected',
        'The OAuth protocol request failed.',
      );
    await client.query(rollbackWhen(value) ? 'rollback' : 'commit');
    return value;
  } catch (error) {
    await client.query('rollback');
    if (timeout(error))
      throw new OperationalError(
        'timeout',
        'The OAuth database request did not complete.',
      );
    throw error;
  } finally {
    client.release();
  }
}

/** A pre-fetch check is advisory. The insert trigger enforces the total bound too. */
export async function oauthClientRoom(
  pool: pg.Pool,
  clientId?: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `set local lock_timeout = '${String(oauthLockTimeoutMs)}ms'`,
    );
    await client.query(
      `set local statement_timeout = '${String(oauthStatementTimeoutMs)}ms'`,
    );
    await client.query(
      "select pg_advisory_xact_lock(hashtext('notesapp:oauth-client-bound')::bigint)",
    );
    const rows = await client.query<{ count: number; existing: boolean }>(
      `select count(*)::int as count, coalesce(bool_or(client_id = $1), false) as existing
      from auth_oauth_client`,
      [clientId ?? null],
    );
    await client.query('commit');
    return (
      rows.rows[0]?.existing === true ||
      (rows.rows[0]?.count ?? maxOAuthClients) < maxOAuthClients
    );
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** One process runs the client sweep for each UTC day, under a transaction lock. */
export async function expireOAuthClients(
  pool: pg.Pool,
  at: Date = new Date(),
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `set local lock_timeout = '${String(oauthLockTimeoutMs)}ms'`,
    );
    await client.query(
      `set local statement_timeout = '${String(oauthStatementTimeoutMs)}ms'`,
    );
    const lock = await client.query<{ held: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext('notesapp:oauth-client-expiry')::bigint) as held",
    );
    if (lock.rows[0]?.held !== true) {
      await client.query('commit');
      return 0;
    }
    const claim = await client.query<{ claimed: boolean }>(
      "select notesapp_claim_daily_run('oauth-clients', $1::date) as claimed",
      [at.toISOString().slice(0, 10)],
    );
    if (claim.rows[0]?.claimed !== true) {
      await client.query('commit');
      return 0;
    }
    const stale = await client.query<{ client_id: string }>(
      `select client_id from auth_oauth_client
      where coalesce(last_used_at, created_at) < $1::timestamptz - interval '30 days' order by client_id`,
      [at],
    );
    // Read the accounts before the pairs. No new token can pass these locks.
    const users = await client.query<{ user_id: string; account_id: string }>(
      `select distinct t.user_id, notesapp_oauth_account(t.user_id) as account_id
      from (select client_id, user_id from auth_oauth_access_token union select client_id, user_id from auth_oauth_refresh_token
        union select client_id, user_id from auth_oauth_consent) t where client_id = any($1::text[]) order by account_id`,
      [stale.rows.map((row) => row.client_id)],
    );
    for (const user of users.rows)
      await client.query('select notesapp_lock_account($1::uuid)', [
        user.account_id,
      ]);
    let removed = 0;
    for (const row of stale.rows) {
      for (const user of users.rows)
        await client.query('select notesapp_oauth_lock_pair($1,$2)', [
          row.client_id,
          user.user_id,
        ]);
      // A token that won the account lock can have used this client in the meantime.
      const current = await client.query<{ stale: boolean }>(
        `select coalesce(last_used_at, created_at) < $2::timestamptz - interval '30 days' as stale
        from auth_oauth_client where client_id = $1`,
        [row.client_id, at],
      );
      if (current.rows[0]?.stale !== true) continue;
      await client.query(
        'delete from auth_oauth_access_token where client_id = $1',
        [row.client_id],
      );
      await client.query(
        'delete from auth_oauth_refresh_token where client_id = $1',
        [row.client_id],
      );
      await client.query(
        'delete from auth_oauth_consent where client_id = $1',
        [row.client_id],
      );
      await client.query(
        "delete from auth_verification where value like '{%' and (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->>'type' = 'authorization_code' and (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->'query'->>'client_id' = $1",
        [row.client_id],
      );
      await client.query('delete from auth_oauth_client where client_id = $1', [
        row.client_id,
      ]);
      removed += 1;
    }
    await client.query('commit');
    return removed;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export type OAuthTokenIdentity = {
  readonly accountId: string;
  readonly authUserId: string;
  readonly standing: ControlStanding;
  readonly grantId: string;
  readonly scopes: readonly string[];
};

/** The only runtime read of the OAuth identity tables. */
export async function resolveOAuthToken(
  pool: pg.Pool,
  digest: string,
  resource: string,
): Promise<OAuthTokenIdentity | null> {
  const rows = await pool.query<{
    account_id: string;
    auth_user_id: string;
    standing: string;
    grant_id: string;
    scopes: string[];
  }>('select * from notesapp_oauth_token_identity($1,$2)', [digest, resource]);
  const row = rows.rows[0];
  if (row === undefined) return null;
  if (row.standing !== 'active' && row.standing !== 'locked')
    throw new Error('The OAuth identity has an unknown standing.');
  return {
    accountId: row.account_id,
    authUserId: row.auth_user_id,
    standing: row.standing,
    grantId: row.grant_id,
    scopes: row.scopes,
  };
}

/** Captures consumed state under the request lock before the provider removes the family. */
export async function oauthReplayCandidate(
  client: pg.PoolClient,
  digest: string,
): Promise<(Pair & { expires_at: Date }) | null> {
  const rows = await client.query<Pair & { expires_at: Date }>(
    `select client_id, user_id, expires_at
    from auth_oauth_refresh_token where token = $1 and revoked is not null
      and rotated_at is not null and expires_at > clock_timestamp()`,
    [digest],
  );
  return rows.rows[0] ?? null;
}

/** The provider authenticates an ordinary revocation, but none of its writes persist. */
export async function oauthRefreshRequest<T>(
  client: pg.PoolClient,
  digest: string,
  run: () => Promise<T>,
  countAttempt: () => Promise<T | null>,
): Promise<T> {
  const rows = await client.query(
    `select id from auth_oauth_refresh_token
    where token = $1 and revoked is not null and rotated_at is null`,
    [digest],
  );
  if (rows.rows.length === 0) return run();
  // This count uses its own committed store, before the provider savepoint.
  const refused = await countAttempt();
  if (refused !== null) return refused;
  // The account and pair locks were taken before this savepoint, so they stay held.
  await client.query('savepoint oauth_ordinary_revocation');
  const answer = await run();
  await client.query('rollback to savepoint oauth_ordinary_revocation');
  await client.query('release savepoint oauth_ordinary_revocation');
  return answer;
}

/** The consent delete trigger revokes the complete pair, including pending codes. */
export async function revokeOAuthReplay(
  client: pg.PoolClient,
  pair: Pair,
): Promise<void> {
  await client.query(
    'delete from auth_oauth_consent where client_id = $1 and user_id = $2',
    [pair.client_id, pair.user_id],
  );
}

/** Revoke one credential only. The request already holds the stored pair lock. */
export async function revokeOAuthToken(
  client: pg.PoolClient,
  digest: string,
  authenticatedClient: string,
): Promise<void> {
  await client.query(
    'delete from auth_oauth_access_token where token=$1 and client_id=$2',
    [digest, authenticatedClient],
  );
  const refresh = await client.query<{ id: string }>(
    'update auth_oauth_refresh_token set revoked=clock_timestamp() where token=$1 and client_id=$2 and revoked is null returning id',
    [digest, authenticatedClient],
  );
  for (const row of refresh.rows)
    await client.query(
      'delete from auth_oauth_access_token where refresh_id=$1',
      [row.id],
    );
}
