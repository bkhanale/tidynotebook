/**
 * The use cases of the daily note settings (record 0099).
 *
 * The settings belong to the account of the actor in one workspace. Neither
 * use case takes an account, so a caller cannot read or write the settings of
 * another member: the transaction binds them to its actor, and the row policy
 * of the table binds them again.
 *
 * Both use cases need the `read` action only. The settings are a choice of
 * the member about their own work, and they change no note.
 */
import type { Actor } from '../identity/actor.ts';
import { fail, ok, type Result } from '../files/model.ts';
import { permitRead } from '../files/permit.ts';
import type { FileRecord, WorkspaceStore } from '../files/ports.ts';
import { defaultDailyNoteSettings, type DailyNoteSettings } from './model.ts';
import { dailyNoteLayoutProblem } from './path.ts';

/**
 * Whether a file can be the template of a daily note.
 *
 * A template is a note that the workspace holds now: not an attachment, not
 * a note in Trash, and not a note that no save has reached yet.
 */
export function isTemplateNote(file: FileRecord | null): boolean {
  return (
    file !== null &&
    file.kind === 'note' &&
    !file.deleted &&
    file.headRevisionId !== null
  );
}

/** The daily note settings of the actor, or the defaults when none is stored. */
export function readDailyNoteSettings(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
): Promise<Result<DailyNoteSettings>> {
  return store.transact<Result<DailyNoteSettings>>(
    actor,
    workspaceId,
    async (tx) => {
      const permitted = await permitRead(tx, actor, workspaceId);
      if (!permitted.ok) return permitted;
      return ok((await tx.dailyNoteSettings()) ?? defaultDailyNoteSettings);
    },
    { readOnly: true },
  );
}

/**
 * Replaces the daily note settings of the actor.
 *
 * A folder and a name format that cannot give every date one valid note path
 * are `invalid_path` (record 0101). A template that names no live note of
 * this workspace is `not_found`, with its identifier. Either way nothing is
 * stored.
 */
export function updateDailyNoteSettings(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  settings: DailyNoteSettings,
): Promise<Result<DailyNoteSettings>> {
  return store.transact<Result<DailyNoteSettings>>(
    actor,
    workspaceId,
    async (tx) => {
      const permitted = await permitRead(tx, actor, workspaceId);
      if (!permitted.ok) return permitted;
      if (dailyNoteLayoutProblem(settings) !== null)
        return fail('invalid_path');
      const templateFileId = settings.templateFileId;
      if (
        templateFileId !== null &&
        !isTemplateNote(await tx.file(templateFileId))
      )
        return fail('not_found', [templateFileId]);
      const stored: DailyNoteSettings = {
        templateFileId,
        openOnStart: settings.openOnStart,
        folder: settings.folder,
        format: settings.format,
      };
      await tx.saveDailyNoteSettings(stored);
      return ok(stored);
    },
  );
}
