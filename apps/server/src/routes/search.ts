/** HTTP adapter for accepted workspace search. */
import type { FastifyRequest } from 'fastify';
import type { Result, WorkspaceStore } from '@notesapp/core';
import { searchFiles } from '@notesapp/core';
import { requireActor } from '../auth/actor.ts';
import { readProperty } from '../values.ts';
import { readText } from './files.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { DomainProblemError } from '../plugins/problem.ts';

const jsonMediaType = 'application/json';

/** Returns the domain value or maps its expected failure to Problem Details. */
function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new DomainProblemError(result.error);
}

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
      const hits = unwrap(
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
