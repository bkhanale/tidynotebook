/**
 * The membership repository: the actor's role in the open workspace.
 *
 * It is the workspaces slice of the port. It reads the membership row and
 * reduces the stored enum to the one role of this product.
 */
import { and, eq } from 'drizzle-orm';
import type { Role, WorkspaceTransaction } from '@notesapp/core';
import { memberships } from '../schema.ts';
import { assertUuid } from './errors.ts';
import type { RepositoryContext } from './context.ts';

/** Builds the membership slice of the port over one open transaction. */
export function membershipRepository(
  context: RepositoryContext,
): Pick<WorkspaceTransaction, 'role'> {
  const { db, workspaceId } = context;
  return {
    async role(accountId: string): Promise<Role | null> {
      assertUuid(accountId, 'the account');
      const rows = await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.accountId, accountId),
          ),
        );
      // The database enum still holds the roles of the removed multi-user
      // product. Only `owner` is a role of this product, so any other stored
      // value grants nothing at all.
      return rows[0]?.role === 'owner' ? 'owner' : null;
    },
  };
}
