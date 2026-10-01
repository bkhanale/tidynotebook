/**
 * HTTP adapter for the template settings of a member (record 0149).
 *
 * The settings belong to the account of the session, so no operation here
 * reads an account from the request. The use cases of `packages/core` hold
 * every rule: a folder that names no folder answers `invalid_path`.
 */
import {
  readTemplateSettings,
  updateTemplateSettings,
  type TemplateSettings,
  type WorkspaceStore,
} from '@notesapp/core';
import { requireActor } from '../auth/actor.ts';
import { unwrapDomain } from '../plugins/problem.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { readText } from './files.ts';

/** The settings as the contract states them. */
function answer(settings: TemplateSettings): HandlerResult {
  return {
    status: 200,
    mediaType: 'application/json',
    body: { folder: settings.folder },
  };
}

/** Builds the handlers of the template settings. */
export function createTemplateHandlers(store: WorkspaceStore): HandlerMap {
  return {
    getTemplateSettings: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      return answer(
        unwrapDomain(await readTemplateSettings(store, actor, workspaceId)),
      );
    },

    updateTemplateSettings: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      return answer(
        unwrapDomain(
          await updateTemplateSettings(store, actor, workspaceId, {
            folder: readText(request.body, 'folder'),
          }),
        ),
      );
    },
  };
}
