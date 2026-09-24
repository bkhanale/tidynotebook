/**
 * HTTP adapter for the daily note settings of a member (record 0099).
 *
 * The settings belong to the account of the session, so no operation here
 * reads an account from the request. The use cases of `packages/core` hold
 * every rule: a template that names no live note answers `not_found`, and a
 * layout that cannot name every date answers `invalid_path` (record 0101).
 */
import {
  readDailyNoteSettings,
  updateDailyNoteSettings,
  type DailyNoteSettings,
  type WorkspaceStore,
} from '@notesapp/core';
import { requireActor } from '../auth/actor.ts';
import { unwrapDomain } from '../plugins/problem.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { readProperty } from '../values.ts';
import { readOptionalText, readText } from './files.ts';

/** The settings as the contract states them. */
function answer(settings: DailyNoteSettings): HandlerResult {
  return {
    status: 200,
    mediaType: 'application/json',
    body: {
      templateFileId: settings.templateFileId,
      openOnStart: settings.openOnStart,
      folder: settings.folder,
      format: settings.format,
    },
  };
}

/** The settings that a validated body states. */
function readSettings(body: unknown): DailyNoteSettings {
  return {
    templateFileId: readOptionalText(body, 'templateFileId'),
    openOnStart: readProperty(body, 'openOnStart') === true,
    folder: readText(body, 'folder'),
    format: readText(body, 'format'),
  };
}

/** Builds the handlers of the daily note settings. */
export function createDailyNoteHandlers(store: WorkspaceStore): HandlerMap {
  return {
    getDailyNoteSettings: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      return answer(
        unwrapDomain(await readDailyNoteSettings(store, actor, workspaceId)),
      );
    },

    updateDailyNoteSettings: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      return answer(
        unwrapDomain(
          await updateDailyNoteSettings(
            store,
            actor,
            workspaceId,
            readSettings(request.body),
          ),
        ),
      );
    },
  };
}
