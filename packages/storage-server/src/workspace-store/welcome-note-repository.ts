/** Welcome note state inside the locked workspace content transaction. */
import type { WelcomeNoteTransaction, WorkspaceStore } from '@notesapp/core';
import { storedStanding } from '../account-controls-row.ts';
import type { RepositoryContext } from './context.ts';

/** Completed and ineligible workspaces do not take the content write lock. */
export async function pendingWelcomeNote(
  context: RepositoryContext,
): Promise<boolean> {
  const result = await context.client.query<{ pending: boolean }>(
    `select exists (
       select 1 from workspace_welcome_notes n
       join workspaces w on w.id = n.workspace_id and w.personal
       where n.workspace_id = $1 and n.completed_at is null
         and public.notesapp_workspace_owner(w.id) = $2
     ) as pending`,
    [context.workspaceId, context.actor.accountId],
  );
  return result.rows[0]?.pending === true;
}

export function welcomeNoteRepository(
  context: RepositoryContext,
  content: WorkspaceStore,
): WelcomeNoteTransaction {
  const { client, workspaceId, actor } = context;
  return {
    content,
    async state() {
      const result = await client.query<{
        completed_at: Date | null;
        standing: string;
      }>(
        `select n.completed_at, a.standing from workspace_welcome_notes n
         join workspaces w on w.id = n.workspace_id and w.personal
         join memberships m on m.workspace_id = w.id and m.role = 'owner'
         join accounts a on a.id = m.account_id
         where n.workspace_id = $1 and a.id = $2`,
        [workspaceId, actor.accountId],
      );
      const row = result.rows[0];
      // The workspace lock is held first. Keep the owner's standing stable
      // until the note and completion record commit together.
      if (row !== undefined && row.completed_at === null) {
        const usage = await client.query<{ standing: string }>(
          'select standing from notesapp_account_usage($1)',
          [workspaceId],
        );
        const owner = usage.rows[0];
        if (owner === undefined)
          throw new Error('notesapp: the welcome note has no workspace owner.');
        row.standing = owner.standing;
      }
      return row === undefined
        ? null
        : {
            completed: row.completed_at !== null,
            standing: storedStanding(row.standing),
          };
    },
    async record(code) {
      await client.query(
        `update workspace_welcome_notes
         set completed_at = case when $2::text is null then now() else null end,
             failure_code = $2
         where workspace_id = $1 and completed_at is null`,
        [workspaceId, code],
      );
    },
  };
}
