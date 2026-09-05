/**
 * PostgreSQL implementation of the account and workspace administration ports.
 *
 * A membership change takes the same advisory workspace lock as a content
 * write, so a role change and a write of one workspace have a defined order.
 * The lock key is the workspace identifier, exactly as in `workspace-store.ts`,
 * so the two pools contend on the same lock.
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
  Action,
  Actor,
  AgentTokenRecord,
  AgentTokenSummary,
  InvitationState,
  InvitationSummary,
  Member,
  Preferences,
  Role,
  ThemeChoice,
  TokenScope,
  WorkspaceAdminStore,
  WorkspaceAdminTransaction,
  WorkspaceSummary,
} from '@notesapp/core';
import { OperationalError } from '@notesapp/core';
import pg from 'pg';
import { defaultQuotaBytes } from './provision.ts';
import { WorkspaceUnavailableError } from './workspace-store.ts';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const roles: readonly Role[] = ['owner', 'admin', 'editor', 'viewer'];
const themes: readonly ThemeChoice[] = ['system', 'light', 'dark'];
const actions: readonly Action[] = [
  'read',
  'write',
  'history',
  'share',
  'members',
  'purge',
];

function isRole(value: string): value is Role {
  return (roles as readonly string[]).includes(value);
}

function isTheme(value: string): value is ThemeChoice {
  return (themes as readonly string[]).includes(value);
}

function isAction(value: unknown): value is Action {
  return (
    typeof value === 'string' && (actions as readonly string[]).includes(value)
  );
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

/** Narrows a stored theme string. An unexpected value falls back to system. */
function asTheme(value: string): ThemeChoice {
  return isTheme(value) ? value : 'system';
}

/**
 * Reads a stored token scope without trusting the stored JSON.
 *
 * A scope entry that this release does not understand is dropped completely
 * rather than narrowed, so a partly understood scope cannot become a smaller
 * scope that then looks verified.
 */
function asScopes(value: unknown): readonly TokenScope[] {
  if (!Array.isArray(value)) return [];
  const scopes: TokenScope[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const record: Record<string, unknown> = Object.fromEntries(
      Object.entries(entry),
    );
    const workspaceId = record.workspaceId;
    const listed = record.actions;
    if (typeof workspaceId !== 'string' || !Array.isArray(listed)) continue;
    if (!listed.every(isAction)) continue;
    scopes.push({ workspaceId, actions: listed });
  }
  return scopes;
}

/** The state of one stored invitation row. */
function invitationState(row: {
  accepted_at: Date | null;
  revoked_at: Date | null;
}): InvitationState {
  if (row.revoked_at !== null) return 'revoked';
  return row.accepted_at === null ? 'pending' : 'accepted';
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
  /** The account of a Better Auth user, or `null` when none is linked. */
  accountOf(authUserId: string): Promise<string | null>;
  /** The current role of one account in each of its workspaces. */
  memberships(
    accountId: string,
  ): Promise<readonly { workspaceId: string; role: Role }[]>;
  /** Resolves one agent token by the hash of its secret. */
  agentToken(secretHash: string): Promise<AgentTokenRecord | null>;
  /** Whether any application account exists. The bootstrap command uses it. */
  hasAccount(): Promise<boolean>;
  /**
   * The workspace and the invited address of one open invitation, or `null`.
   *
   * The invitation is not consumed. The sign-up path needs the address before
   * any account exists, so this call is not bound to an actor.
   */
  openInvitation(
    tokenHash: string,
  ): Promise<{ workspaceId: string; email: string } | null>;
  /**
   * Appends one content free audit record to the personal workspace of an
   * account. The operator recovery command uses it.
   */
  recordAccountAudit(accountId: string, action: string): Promise<void>;
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

  /** Appends one content free audit record. */
  async function writeAudit(
    client: pg.PoolClient,
    workspaceId: string,
    accountId: string,
    input: {
      readonly action: string;
      readonly targetKind: string;
      readonly targetId: string | null;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_events
         (workspace_id, id, actor_account_id, action, target_kind, target_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        workspaceId,
        randomUUID(),
        accountId,
        input.action,
        input.targetKind,
        input.targetId,
      ],
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
        const rows = await client.query<{ theme: string }>(
          'select theme from account_preferences where account_id = $1',
          [accountId],
        );
        return { theme: asTheme(rows.rows[0]?.theme ?? 'system') };
      },

      async savePreferences(preferences: Preferences): Promise<void> {
        await client.query(
          `insert into account_preferences (account_id, theme, updated_at)
             values ($1, $2, now())
           on conflict (account_id)
             do update set theme = excluded.theme, updated_at = now()`,
          [accountId, preferences.theme],
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

      async audit(workspaceId: string, input): Promise<void> {
        assertUuid(workspaceId, 'the workspace');
        await writeAudit(client, workspaceId, accountId, input);
      },

      async recordMembershipChange(workspaceId: string, input): Promise<void> {
        assertUuid(workspaceId, 'the workspace');
        await writeMembershipChange(client, workspaceId, input);
      },

      async agentTokens(): Promise<readonly AgentTokenSummary[]> {
        const rows = await client.query<{
          id: string;
          name: string;
          prefix: string;
          scopes: unknown;
          expires_at: Date;
          created_at: Date;
          revoked_at: Date | null;
        }>(
          `select id, name, prefix, scopes, expires_at, created_at, revoked_at
             from agent_tokens where account_id = $1 order by created_at desc, id asc`,
          [accountId],
        );
        return rows.rows.map((row) => ({
          id: row.id,
          name: row.name,
          prefix: row.prefix,
          scopes: asScopes(row.scopes),
          expiresAt: row.expires_at.toISOString(),
          createdAt: row.created_at.toISOString(),
          revokedAt:
            row.revoked_at === null ? null : row.revoked_at.toISOString(),
        }));
      },

      async createAgentToken(input): Promise<void> {
        assertUuid(input.id, 'the token');
        await client.query(
          `insert into agent_tokens
             (id, account_id, name, prefix, token_hash, scopes, expires_at)
           values ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
          [
            input.id,
            accountId,
            input.name,
            input.prefix,
            input.secretHash,
            JSON.stringify(input.scopes),
            input.expiresAt,
          ],
        );
      },

      async revokeAgentToken(tokenId: string): Promise<boolean> {
        assertUuid(tokenId, 'the token');
        const result = await client.query(
          `update agent_tokens set revoked_at = now()
            where id = $1 and account_id = $2 and revoked_at is null`,
          [tokenId, accountId],
        );
        return (result.rowCount ?? 0) > 0;
      },

      async openInvitation(tokenHash: string) {
        const rows = await client.query<{
          invited_workspace_id: string;
          invited_email: string;
        }>('select * from notesapp_open_invitation($1)', [tokenHash]);
        const row = rows.rows[0];
        if (row === undefined) return null;
        return {
          workspaceId: row.invited_workspace_id,
          email: row.invited_email,
        };
      },

      async claimInvitation(input) {
        // The workspace of the invitation is read first, so acceptance takes
        // the same lock as every other membership write of that workspace.
        const open = await client.query<{ invited_workspace_id: string }>(
          'select invited_workspace_id from notesapp_open_invitation($1)',
          [input.tokenHash],
        );
        const workspaceId = open.rows[0]?.invited_workspace_id;
        if (workspaceId === undefined) return null;
        await lockWorkspace(client, workspaceId);
        const rows = await client.query<{
          granted_workspace_id: string;
          granted_role: string;
        }>('select * from notesapp_claim_invitation($1, $2)', [
          input.tokenHash,
          input.email,
        ]);
        const row = rows.rows[0];
        if (row === undefined) return null;
        return {
          workspaceId: row.granted_workspace_id,
          role: asRole(row.granted_role),
        };
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

      async members(): Promise<readonly Member[]> {
        // The runtime role holds no right on the identity tables, so the
        // directory function reads the address and the display name and
        // returns nothing else. It requires a membership of its own.
        const rows = await client.query<{
          member_account_id: string;
          member_role: string;
          member_email: string | null;
          member_name: string | null;
        }>('select * from notesapp_workspace_members($1)', [workspaceId]);
        return rows.rows.map((row) => ({
          accountId: row.member_account_id,
          role: asRole(row.member_role),
          email: row.member_email,
          name: row.member_name,
        }));
      },

      async invitations(): Promise<readonly InvitationSummary[]> {
        const rows = await client.query<{
          id: string;
          email: string;
          role: string;
          expires_at: Date;
          accepted_at: Date | null;
          revoked_at: Date | null;
        }>(
          `select id, email, role::text as role, expires_at, accepted_at, revoked_at
             from invitations where workspace_id = $1
            order by created_at desc, id asc`,
          [workspaceId],
        );
        return rows.rows.map((row) => ({
          id: row.id,
          workspaceId,
          email: row.email,
          role: asRole(row.role),
          expiresAt: row.expires_at.toISOString(),
          state: invitationState(row),
        }));
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

      async setRole(account: string, role: Role): Promise<void> {
        assertUuid(account, 'the account');
        await client.query(
          `update memberships set role = $3
            where workspace_id = $1 and account_id = $2`,
          [workspaceId, account, role],
        );
      },

      async removeMember(account: string): Promise<boolean> {
        assertUuid(account, 'the account');
        const result = await client.query(
          'delete from memberships where workspace_id = $1 and account_id = $2',
          [workspaceId, account],
        );
        return (result.rowCount ?? 0) > 0;
      },

      async transferOwnership(account: string, leave: boolean): Promise<void> {
        assertUuid(account, 'the account');
        await client.query('select notesapp_transfer_ownership($1, $2, $3)', [
          workspaceId,
          account,
          leave,
        ]);
      },

      async createInvitation(input): Promise<void> {
        assertUuid(input.id, 'the invitation');
        await client.query(
          `insert into invitations
             (workspace_id, id, email, role, token_hash, invited_by, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
          [
            workspaceId,
            input.id,
            input.email,
            input.role,
            input.tokenHash,
            accountId,
            input.expiresAt,
          ],
        );
      },

      async audit(input): Promise<void> {
        await writeAudit(client, workspaceId, accountId, input);
      },

      async auditActorHome(input): Promise<boolean> {
        // Deleting a workspace removes its own audit rows, so the record of
        // that deletion is written to another workspace of the actor. The
        // deleted identifier travels as the content free target.
        const rows = await client.query<{ workspace_id: string }>(
          `select m.workspace_id from memberships m
             join workspaces w on w.id = m.workspace_id
            where m.account_id = $1 and m.workspace_id <> $2
            order by w.personal desc, w.id asc
            limit 1`,
          [accountId, workspaceId],
        );
        const home = rows.rows[0]?.workspace_id;
        if (home === undefined) return false;
        await writeAudit(client, home, accountId, {
          action: input.action,
          targetKind: 'workspace',
          targetId: workspaceId,
        });
        return true;
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

    async agentToken(secretHash: string): Promise<AgentTokenRecord | null> {
      return inTransaction(null, null, async (client) => {
        const rows = await client.query<{
          token_id: string;
          owner_account_id: string;
          token_scopes: unknown;
          token_expires_at: Date;
          token_revoked_at: Date | null;
        }>('select * from notesapp_agent_token($1)', [secretHash]);
        const row = rows.rows[0];
        if (row === undefined) return null;
        return {
          id: row.token_id,
          accountId: row.owner_account_id,
          scopes: asScopes(row.token_scopes),
          expiresAt: row.token_expires_at.toISOString(),
          revokedAt:
            row.token_revoked_at === null
              ? null
              : row.token_revoked_at.toISOString(),
        };
      });
    },

    async openInvitation(tokenHash: string) {
      return inTransaction(null, null, async (client) => {
        const rows = await client.query<{
          invited_workspace_id: string;
          invited_email: string;
        }>('select * from notesapp_open_invitation($1)', [tokenHash]);
        const row = rows.rows[0];
        if (row === undefined) return null;
        return {
          workspaceId: row.invited_workspace_id,
          email: row.invited_email,
        };
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
      await inTransaction(accountId, null, async (client) => {
        const rows = await client.query<{ workspace_id: string }>(
          `select m.workspace_id from memberships m
             join workspaces w on w.id = m.workspace_id
            where m.account_id = $1
            order by w.personal desc, w.id asc
            limit 1`,
          [accountId],
        );
        const workspaceId = rows.rows[0]?.workspace_id;
        if (workspaceId === undefined) return;
        await client.query(
          `insert into audit_events
             (workspace_id, id, actor_account_id, action, target_kind, target_id)
           values ($1, $2, $3, $4, 'account', $3)`,
          [workspaceId, randomUUID(), accountId, action],
        );
      });
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
