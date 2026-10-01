/**
 * The use cases of the template settings (record 0149).
 *
 * The settings belong to the account of the actor in one workspace, as the
 * daily note settings of record 0099 do. Neither use case takes an account,
 * so a caller cannot read or write the settings of another member: the
 * transaction binds them to its actor, and the row policy of the table binds
 * them again.
 *
 * Both use cases need the `read` action only. The settings are a choice of
 * the member about their own work, and they change no note.
 */
import type { Actor } from '../identity/actor.ts';
import { fail, ok, type Result } from '../files/model.ts';
import { permitRead } from '../files/permit.ts';
import type { WorkspaceStore } from '../files/ports.ts';
import {
  defaultTemplateSettings,
  templateFolderProblem,
  type TemplateSettings,
} from './model.ts';

/** The template settings of the actor, or the defaults when none is stored. */
export function readTemplateSettings(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
): Promise<Result<TemplateSettings>> {
  return store.transact<Result<TemplateSettings>>(
    actor,
    workspaceId,
    async (tx) => {
      const permitted = await permitRead(tx, actor, workspaceId);
      if (!permitted.ok) return permitted;
      return ok((await tx.templateSettings()) ?? defaultTemplateSettings);
    },
    { readOnly: true },
  );
}

/**
 * Replaces the template settings of the actor.
 *
 * A folder that is empty, or that the folder rules refuse in its stored
 * spelling, is `invalid_path`, and nothing is stored.
 */
export function updateTemplateSettings(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  settings: TemplateSettings,
): Promise<Result<TemplateSettings>> {
  return store.transact<Result<TemplateSettings>>(
    actor,
    workspaceId,
    async (tx) => {
      const permitted = await permitRead(tx, actor, workspaceId);
      if (!permitted.ok) return permitted;
      if (templateFolderProblem(settings.folder) !== null)
        return fail('invalid_path');
      const stored: TemplateSettings = { folder: settings.folder };
      await tx.saveTemplateSettings(stored);
      return ok(stored);
    },
  );
}
