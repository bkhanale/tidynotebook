/** HTTP adapter for the accepted path-based backlink index. */
import { listBacklinks, type Result, type WorkspaceStore } from '@notesapp/core';
import { requireActor } from '../auth/actor.ts';
import { DomainProblemError } from '../plugins/problem.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { readText } from './files.ts';

function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new DomainProblemError(result.error);
}

/** Builds the backlink operation handler. */
export function createBacklinkHandlers(store: WorkspaceStore): HandlerMap {
  return {
    listBacklinks: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const backlinks = unwrap(
        await listBacklinks(store, actor, workspaceId, fileId),
      );
      return {
        status: 200,
        mediaType: 'application/json',
        body: { backlinks: backlinks.map((entry) => ({ ...entry })) },
      };
    },
  };
}
