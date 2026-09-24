/** HTTP adapter for accepted workspace search. */
import type { FastifyRequest } from 'fastify';
import type { WorkspaceStore } from '@notesapp/core';
import { searchFiles } from '@notesapp/core';
import { requireActor } from '../auth/actor.ts';
import { readProperty } from '../values.ts';
import { readText } from './files.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { unwrapDomain } from '../plugins/problem.ts';

const jsonMediaType = 'application/json';

/** Optional validated integer query member. */
function optionalLimit(query: unknown): number | null {
  const value = readProperty(query, 'limit');
  return typeof value === 'number' ? value : null;
}

/** Builds handlers whose response bodies follow generated contract schemas. */
export function createSearchHandlers(store: WorkspaceStore): HandlerMap {
  return {
    searchFiles: async (request: FastifyRequest): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const query = readText(request.query, 'query');
      const hits = unwrapDomain(
        await searchFiles(
          store,
          actor,
          workspaceId,
          query,
          optionalLimit(request.query),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: { hits: hits.map((hit) => ({ ...hit })) },
      };
    },
  };
}
