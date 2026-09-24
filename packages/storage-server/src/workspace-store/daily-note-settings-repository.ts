/**
 * The daily note settings repository: the settings of the actor in the open
 * workspace (record 0099).
 *
 * Every statement names the account of the verified actor of the transaction
 * and never an account that a caller passes, so the port has no argument that
 * could name another member. The row policy of migration 0009 binds the same
 * two keys again.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DailyNoteSettings, WorkspaceTransaction } from '@notesapp/core';
import { dailyNoteSettings } from '../schema.ts';
import { assertUuid } from './errors.ts';
import type { RepositoryContext } from './context.ts';

/** Builds the daily note settings slice of the port over one transaction. */
export function dailyNoteSettingsRepository(
  context: RepositoryContext,
): Pick<WorkspaceTransaction, 'dailyNoteSettings' | 'saveDailyNoteSettings'> {
  const { db, actor, workspaceId } = context;
  return {
    async dailyNoteSettings(): Promise<DailyNoteSettings | null> {
      const rows = await db
        .select({
          templateFileId: dailyNoteSettings.templateFileId,
          openOnStart: dailyNoteSettings.openOnStart,
        })
        .from(dailyNoteSettings)
        .where(
          and(
            eq(dailyNoteSettings.workspaceId, workspaceId),
            eq(dailyNoteSettings.accountId, actor.accountId),
          ),
        );
      const row = rows[0];
      return row === undefined
        ? null
        : { templateFileId: row.templateFileId, openOnStart: row.openOnStart };
    },

    async saveDailyNoteSettings(settings: DailyNoteSettings): Promise<void> {
      if (settings.templateFileId !== null)
        assertUuid(settings.templateFileId, 'the template');
      await db
        .insert(dailyNoteSettings)
        .values({
          workspaceId,
          accountId: actor.accountId,
          templateFileId: settings.templateFileId,
          openOnStart: settings.openOnStart,
        })
        .onConflictDoUpdate({
          target: [dailyNoteSettings.workspaceId, dailyNoteSettings.accountId],
          set: {
            templateFileId: settings.templateFileId,
            openOnStart: settings.openOnStart,
            updatedAt: sql`now()`,
          },
        });
    },
  };
}
