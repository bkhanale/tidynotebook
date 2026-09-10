/**
 * Account and workspace provisioning with the migration role.
 *
 * A new account and a new workspace exist before any member can read them, so
 * the runtime role's member policies cannot create them. Provisioning
 * therefore uses the schema owner connection. The bootstrap command builds on
 * these calls.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Role } from '@notesapp/core';
import {
  accounts,
  memberships,
  workspaceCursors,
  workspaceUsage,
  workspaces,
} from './schema.ts';

/** The design's default workspace storage quota of 5 GiB. */
export const defaultQuotaBytes = 5n * 1024n * 1024n * 1024n;

/** One workspace and its members. */
export type WorkspaceSeed = {
  readonly workspaceId: string;
  readonly name: string;
  readonly quotaBytes?: bigint;
  readonly members: readonly {
    readonly accountId: string;
    readonly role: Role;
  }[];
};

/** Creates the account identity rows that do not exist yet. */
export async function provisionAccounts(
  migrationUrl: string,
  accountIds: readonly string[],
): Promise<void> {
  if (accountIds.length === 0) return;
  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    await drizzle({ client })
      .insert(accounts)
      .values(accountIds.map((id) => ({ id })))
      .onConflictDoNothing();
  } finally {
    await client.end();
  }
}

/**
 * Creates one workspace, its members, its usage record, and its cursor.
 *
 * Every account named in `members` must exist already.
 */
export async function provisionWorkspace(
  migrationUrl: string,
  seed: WorkspaceSeed,
): Promise<void> {
  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    const db = drizzle({ client });
    await client.query('begin');
    try {
      await db
        .insert(workspaces)
        .values({ id: seed.workspaceId, name: seed.name })
        .onConflictDoNothing();
      await db
        .insert(workspaceUsage)
        .values({
          workspaceId: seed.workspaceId,
          bytesUsed: 0n,
          quotaBytes: seed.quotaBytes ?? defaultQuotaBytes,
        })
        .onConflictDoNothing();
      await db
        .insert(workspaceCursors)
        .values({ workspaceId: seed.workspaceId, lastCursor: 0n })
        .onConflictDoNothing();
      if (seed.members.length > 0) {
        await db
          .insert(memberships)
          .values(
            seed.members.map((member) => ({
              workspaceId: seed.workspaceId,
              accountId: member.accountId,
              role: member.role,
            })),
          )
          .onConflictDoNothing();
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    await client.end();
  }
}
