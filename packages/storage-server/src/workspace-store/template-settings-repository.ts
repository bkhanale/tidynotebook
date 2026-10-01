/**
 * The template settings repository: the settings of the actor in the open
 * workspace (record 0149).
 *
 * Every statement names the account of the verified actor of the transaction
 * and never an account that a caller passes, so the port has no argument that
 * could name another member. The row policy of migration 0026 binds the same
 * two keys again.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { TemplateSettings, WorkspaceTransaction } from '@notesapp/core';
import { templateSettings } from '../schema.ts';
import type { RepositoryContext } from './context.ts';

/** Builds the template settings slice of the port over one transaction. */
export function templateSettingsRepository(
  context: RepositoryContext,
): Pick<WorkspaceTransaction, 'templateSettings' | 'saveTemplateSettings'> {
  const { db, actor, workspaceId } = context;
  return {
    async templateSettings(): Promise<TemplateSettings | null> {
      const rows = await db
        .select({ folder: templateSettings.folder })
        .from(templateSettings)
        .where(
          and(
            eq(templateSettings.workspaceId, workspaceId),
            eq(templateSettings.accountId, actor.accountId),
          ),
        );
      const row = rows[0];
      return row === undefined ? null : { folder: row.folder };
    },

    async saveTemplateSettings(settings: TemplateSettings): Promise<void> {
      await db
        .insert(templateSettings)
        .values({
          workspaceId,
          accountId: actor.accountId,
          folder: settings.folder,
        })
        .onConflictDoUpdate({
          target: [templateSettings.workspaceId, templateSettings.accountId],
          set: { folder: settings.folder, updatedAt: sql`now()` },
        });
    },
  };
}
