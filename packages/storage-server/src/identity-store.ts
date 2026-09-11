/**
 * PostgreSQL implementation of the account and workspace administration ports.
 *
 * A membership change takes the same advisory workspace lock as a content
 * write, so the two have a defined order. The lock key is the workspace
 * identifier, exactly as in `workspace-store.ts`, so the two pools contend on
 * the same lock.
 *
 * The runtime role holds no right to insert a workspace, an account, or
 * another account's membership row. Those writes go through the reviewed
 * SECURITY DEFINER functions of `migrations/0003_identity_access.sql`, which
 * check the caller's role themselves. The rules in `@notesapp/core` are the
 * first control; those functions and the row policies are the second.
 */
import { randomUUID } from 'node:crypto';
import type {
  AccountTransaction,
  Actor,
  AppearanceChoice,
  Preferences,
  Role,
  WorkspaceAdminStore,
  WorkspaceAdminTransaction,
  WorkspaceSummary,
} from '@notesapp/core';
import { isThemeFamilyId, OperationalError } from '@notesapp/core';
import pg from 'pg';
import { defaultQuotaBytes } from './provision.ts';
import { WorkspaceUnavailableError } from './workspace-store.ts';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const roles: readonly Role[] = ['owner'];

/** The family a row without a stored choice renders with. */
const defaultThemeFamily = 'tokyo-night';
const appearances: readonly AppearanceChoice[] = ['system', 'light', 'dark'];

function isRole(value: string): value is Role {
  return (roles as readonly string[]).includes(value);
}

function isAppearance(value: string): value is AppearanceChoice {
  return (appearances as readonly string[]).includes(value);
}

/** Rejects an identifier that is not a UUID before it reaches SQL. */
function assertUuid(value: string, what: string): void {
  if (!uuidPattern.test(value)) {
    throw new OperationalError(
      'unexpected',
      `notesapp: ${what} is not a UUID; the transport must validate it.`,
    );
  }
}

/** Narrows a stored role string. An unexpected value is a defect. */
function asRole(value: string): Role {
  if (!isRole(value)) {
    throw new OperationalError(
      'unexpected',
      'notesapp: a membership row holds an unknown role.',
    );
  }
  return value;
}

/**
 * Narrows a stored appearance string. An unexpected value falls back to
 * system, so a row written by another release still renders.
 */
function asAppearance(value: string): AppearanceChoice {
  return isAppearance(value) ? value : 'system';
}

/**
 * Narrows a stored theme family string.
 *
 * The palette registry lives in the browser package, so the store checks the
 * slug shape only and lets the client fall back when it does not know the
 * family.
 */
function asThemeFamily(value: string): string {
  return isThemeFamilyId(value) ? value : defaultThemeFamily;
}

/** An identity store and the calls that a process needs to manage its pool. */
export type IdentityStoreHandle = WorkspaceAdminStore & {
  /**
   * Maps a verified Better Auth user to an application account.
   *
   * The call is idempotent: the first call creates the account, its personal
   * workspace, and the map row in one transaction, and every later call
   * returns the account that already exists.
   */
  linkAccount(input: {
    readonly authUserId: string;
    readonly workspaceName: string;
    readonly quotaBytes?: bigint;
  }): Promise<string>;
  /** Links the only account, or returns null when setup already completed. */
  linkFirstAccount(input: {
    readonly authUserId: string;
    readonly workspaceName: string;
    readonly quotaBytes?: bigint;
  }): Promise<string | null>;
  /** The account of a Better Auth user, or `null` when none is linked. */
  accountOf(authUserId: string): Promise<string | null>;
  /** The current role of one account in each of its workspaces. */
  memberships(
    accountId: string,
  ): Promise<readonly { workspaceId: string; role: Role }[]>;
  /** Whether any application account exists. The bootstrap command uses it. */
  hasAccount(): Promise<boolean>;
  /**
   * Appends one content free record to the audit trail of an account. The
   * operator recovery command uses it.
   */
  recordAccountAudit(accountId: string, action: string): Promise<void>;
  /**
   * Removes an account that a sign-up attempt created and never used.
   *
   * The call is bound to that account: the database function refuses every
   * account that is not the identity of the transaction, so one account can
   * never remove another. It also refuses when any retained record still names
   * the account, when it belongs to a workspace that is not its own personal
   * one, or when that workspace holds anything at all. The answer is then
   * false rather than a failure.
   */
  discardAccount(authUserId: string): Promise<boolean>;
  /** Closes every pooled connection. */
  close(): Promise<void>;
};

/** Options of one identity store pool. */
export type IdentityStoreOptions = {
  /** Maximum pooled connections. */
  readonly poolSize?: number;
};

/** Opens the account and workspace administration store. */
export function openIdentityStore(
  databaseUrl: string,
  options: IdentityStoreOptions = {},
): IdentityStoreHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.poolSize ?? 10,
  });

  /** Runs one transaction with the account identity of the actor. */
  async function inTransaction<T>(
    accountId: string | null,
    workspaceId: string | null,
    run: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch {
      // The driver's own message repeats the host, the port, and the role of
      // the connection URL, so it is replaced rather than wrapped.
      throw new OperationalError(
        'unavailable',
        'notesapp: the identity store is not reachable.',
      );
    }
    try {
      await client.query('begin');
      try {
        if (accountId !== null) {
          await client.query(
            "select set_config('notesapp.account_id', $1, true)",
            [accountId],
          );
        }
        if (workspaceId !== null) {
          await client.query(
            'select pg_advisory_xact_lock(hashtext($1::text)::bigint)',
            [workspaceId],
          );
        }
        const value = await run(client);
        await client.query('commit');
        return value;
      } catch (error) {
        try {
          await client.query('rollback');
        } catch {
          // The connection is already unusable; report the first failure.
        }
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /** Takes the advisory lock that every write of one workspace shares. */
  async function lockWorkspace(
    client: pg.PoolClient,
    workspaceId: string,
  ): Promise<void> {
    assertUuid(workspaceId, 'the workspace');
    await client.query(
      'select pg_advisory_xact_lock(hashtext($1::text)::bigint)',
      [workspaceId],
    );
  }

  /** Appends one content free record to the audit trail of one account. */
  async function writeAccountAudit(
    client: pg.PoolClient,
    accountId: string,
    input: {
      readonly action: string;
      readonly targetKind: string;
      readonly targetId: string | null;
    },
  ): Promise<void> {
    await client.query(
      `insert into account_audit_events
         (id, account_id, action, target_kind, target_id)
       values ($1, $2, $3, $4, $5)`,
      [randomUUID(), accountId, input.action, input.targetKind, input.targetId],
    );
  }

  /** Appends one incremental membership record under the workspace lock. */
  async function writeMembershipChange(
    client: pg.PoolClient,
    workspaceId: string,
    input: { readonly accountId: string; readonly removed: boolean },
  ): Promise<void> {
    const allocated = await client.query<{ cursor: string }>(
      'select notesapp_next_cursor($1) as cursor',
      [workspaceId],
    );
    const cursor = allocated.rows[0]?.cursor;
    if (cursor === undefined) {
      throw new OperationalError(
        'unexpected',
        'notesapp: the workspace cursor was not allocated.',
      );
    }
    await client.query(
      `insert into sync_changes
         (workspace_id, cursor, entity_kind, entity_id, deleted)
       values ($1, $2::bigint, 'membership', $3, $4)`,
      [workspaceId, cursor, input.accountId, input.removed],
    );
  }

  function accountTransaction(
    client: pg.PoolClient,
    accountId: string,
  ): AccountTransaction {
    return {
      async workspaces(): Promise<readonly WorkspaceSummary[]> {
        const rows = await client.query<{
          id: string;
          name: string;
          personal: boolean;
          role: string;
        }>(
          `select w.id, w.name, w.personal, m.role::text as role
             from memberships m
             join workspaces w on w.id = m.workspace_id
            where m.account_id = $1
            order by w.personal desc, w.name asc, w.id asc`,
          [accountId],
        );
        return rows.rows.map((row) => ({
          workspaceId: row.id,
          name: row.name,
          personal: row.personal,
          role: asRole(row.role),
        }));
      },

      async memberships() {
        const rows = await client.query<{ workspace_id: string; role: string }>(
          `select workspace_id, role::text as role
             from memberships where account_id = $1 order by workspace_id`,
          [accountId],
        );
        return rows.rows.map((row) => ({
          workspaceId: row.workspace_id,
          role: asRole(row.role),
        }));
      },

      async preferences(): Promise<Preferences> {
        const rows = await client.query<{
          theme: string;
          theme_family: string;
        }>(
          `select theme, theme_family from account_preferences
             where account_id = $1`,
          [accountId],
        );
        const row = rows.rows[0];
        return {
          appearance: asAppearance(row?.theme ?? 'system'),
          themeFamily: asThemeFamily(row?.theme_family ?? defaultThemeFamily),
        };
      },

      async savePreferences(preferences: Preferences): Promise<void> {
        await client.query(
          `insert into account_preferences
             (account_id, theme, theme_family, updated_at)
             values ($1, $2, $3, now())
           on conflict (account_id)
             do update set theme = excluded.theme,
                           theme_family = excluded.theme_family,
                           updated_at = now()`,
          [accountId, preferences.appearance, preferences.themeFamily],
        );
      },

      async createWorkspace(input): Promise<void> {
        assertUuid(input.workspaceId, 'the workspace');
        // The new workspace takes the same lock as every other write of that
        // workspace, so its first membership record and its first cursor are
        // allocated in the same order as a later change.
        await lockWorkspace(client, input.workspaceId);
        await client.query('select notesapp_create_workspace($1, $2, $3)', [
          input.workspaceId,
          input.name,
          defaultQuotaBytes.toString(),
        ]);
      },

      async lockWorkspace(workspaceId: string): Promise<void> {
        await lockWorkspace(client, workspaceId);
      },

      async recordMembershipChange(workspaceId: string, input): Promise<void> {
        assertUuid(workspaceId, 'the workspace');
        await writeMembershipChange(client, workspaceId, input);
      },
    };
  }

  function workspaceTransaction(
    client: pg.PoolClient,
    accountId: string,
    workspaceId: string,
  ): WorkspaceAdminTransaction {
    return {
      async describe(): Promise<{ name: string; personal: boolean } | null> {
        const rows = await client.query<{ name: string; personal: boolean }>(
          'select name, personal from workspaces where id = $1',
          [workspaceId],
        );
        const row = rows.rows[0];
        return row === undefined
          ? null
          : { name: row.name, personal: row.personal };
      },

      async role(account: string): Promise<Role | null> {
        assertUuid(account, 'the account');
        const rows = await client.query<{ role: string }>(
          `select role::text as role from memberships
            where workspace_id = $1 and account_id = $2`,
          [workspaceId, account],
        );
        const value = rows.rows[0]?.role;
        return value === undefined ? null : asRole(value);
      },

      async rename(name: string): Promise<void> {
        await client.query('update workspaces set name = $2 where id = $1', [
          workspaceId,
          name,
        ]);
      },

      async destroy(): Promise<void> {
        await client.query('select notesapp_delete_workspace($1)', [
          workspaceId,
        ]);
      },

      async auditAccount(input): Promise<void> {
        // Deleting a workspace removes every row of it, so the record of that
        // deletion goes to the account trail, which no workspace owns.
        await writeAccountAudit(client, accountId, {
          action: input.action,
          targetKind: 'workspace',
          targetId: workspaceId,
        });
      },

      async recordMembershipChange(input): Promise<void> {
        await writeMembershipChange(client, workspaceId, input);
      },
    };
  }

  return {
    account<T>(
      actor: Actor,
      run: (tx: AccountTransaction) => Promise<T>,
    ): Promise<T> {
      assertUuid(actor.accountId, 'the actor account');
      return inTransaction(actor.accountId, null, (client) =>
        run(accountTransaction(client, actor.accountId)),
      );
    },

    workspace<T>(
      actor: Actor,
      workspaceId: string,
      run: (tx: WorkspaceAdminTransaction) => Promise<T>,
    ): Promise<T> {
      assertUuid(actor.accountId, 'the actor account');
      assertUuid(workspaceId, 'the workspace');
      return inTransaction(actor.accountId, workspaceId, async (client) => {
        const seen = await client.query(
          'select id from workspaces where id = $1',
          [workspaceId],
        );
        if (seen.rowCount === 0)
          throw new WorkspaceUnavailableError(workspaceId);
        return run(workspaceTransaction(client, actor.accountId, workspaceId));
      });
    },

    async linkAccount(input): Promise<string> {
      const accountId = randomUUID();
      const workspaceId = randomUUID();
      return inTransaction(null, null, async (client) => {
        const rows = await client.query<{ account: string }>(
          'select notesapp_link_account($1, $2, $3, $4, $5::bigint) as account',
          [
            input.authUserId,
            accountId,
            workspaceId,
            input.workspaceName,
            (input.quotaBytes ?? defaultQuotaBytes).toString(),
          ],
        );
        const linked = rows.rows[0]?.account;
        if (linked === undefined) {
          throw new OperationalError(
            'unexpected',
            'notesapp: the account was not linked.',
          );
        }
        return linked;
      });
    },

    async linkFirstAccount(input): Promise<string | null> {
      const accountId = randomUUID();
      const workspaceId = randomUUID();
      return inTransaction(null, null, async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtext('notesapp:first-account')::bigint)",
        );
        const present = await client.query<{ present: boolean }>(
          'select notesapp_has_account() as present',
        );
        if (present.rows[0]?.present === true) return null;
        const rows = await client.query<{ account: string }>(
          'select notesapp_link_account($1, $2, $3, $4, $5::bigint) as account',
          [
            input.authUserId,
            accountId,
            workspaceId,
            input.workspaceName,
            (input.quotaBytes ?? defaultQuotaBytes).toString(),
          ],
        );
        const linked = rows.rows[0]?.account;
        if (linked === undefined) {
          throw new OperationalError(
            'unexpected',
            'notesapp: the first account was not linked.',
          );
        }
        return linked;
      });
    },

    async accountOf(authUserId: string): Promise<string | null> {
      return inTransaction(null, null, async (client) => {
        const rows = await client.query<{ account: string | null }>(
          'select notesapp_account_of($1) as account',
          [authUserId],
        );
        return rows.rows[0]?.account ?? null;
      });
    },

    async memberships(accountId: string) {
      assertUuid(accountId, 'the account');
      return inTransaction(accountId, null, async (client) => {
        const rows = await client.query<{ workspace_id: string; role: string }>(
          `select workspace_id, role::text as role
             from memberships where account_id = $1 order by workspace_id`,
          [accountId],
        );
        return rows.rows.map((row) => ({
          workspaceId: row.workspace_id,
          role: asRole(row.role),
        }));
      });
    },

    async hasAccount(): Promise<boolean> {
      return inTransaction(null, null, async (client) => {
        const rows = await client.query<{ present: boolean }>(
          'select notesapp_has_account() as present',
        );
        return rows.rows[0]?.present ?? false;
      });
    },

    async recordAccountAudit(accountId: string, action: string): Promise<void> {
      assertUuid(accountId, 'the account');
      await inTransaction(accountId, null, (client) =>
        writeAccountAudit(client, accountId, {
          action,
          targetKind: 'account',
          targetId: accountId,
        }),
      );
    },

    async discardAccount(authUserId: string): Promise<boolean> {
      // The function is bound to the account of the transaction, so the
      // identity is set to the account that is being removed. An identity free
      // call would be refused, which is what stops one account from removing
      // another.
      const accountId = await this.accountOf(authUserId);
      if (accountId === null) return false;
      return inTransaction(accountId, null, async (client) => {
        const rows = await client.query<{ discarded: boolean }>(
          'select notesapp_discard_account($1) as discarded',
          [authUserId],
        );
        return rows.rows[0]?.discarded ?? false;
      });
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
