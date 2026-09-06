/**
 * Permission checked workspace search and backlink use cases.
 *
 * Storage owns the text index. The core owns the read permission check, result
 * limits, and the public result shapes. This keeps database rows out of HTTP
 * responses and applies the same role and token grant intersection as normal
 * file reads.
 */
import { authorize, type Actor } from '../identity/actor.ts';
import { fail, ok, type Result } from '../files/model.ts';
import type { WorkspaceStore, WorkspaceTransaction } from '../files/ports.ts';

/** One accepted note that matched a search query. */
export type SearchHit = {
  readonly fileId: string;
  readonly path: string;
  readonly revisionId: string;
  readonly excerpt: string;
};

/** One accepted note that links to the requested note. */
export type Backlink = SearchHit & {
  readonly sourceText: string;
};

/** Default and maximum result counts at the domain boundary. */
export const defaultSearchLimit = 50;
export const maxSearchLimit = 100;

/** Keeps a requested result count inside the served range. */
export function searchLimit(limit: number | null): number {
  if (limit === null || !Number.isFinite(limit)) return defaultSearchLimit;
  return Math.min(Math.max(1, Math.trunc(limit)), maxSearchLimit);
}

/** Checks both the current workspace role and the verified actor grant. */
async function permitRead(
  tx: WorkspaceTransaction,
  actor: Actor,
  workspaceId: string,
): Promise<Result<void>> {
  const role = await tx.role(actor.accountId);
  if (role === null) return fail('forbidden');
  return authorize(actor, workspaceId, role, 'read');
}

/** Searches only the accepted live notes of one workspace. */
export function searchFiles(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  query: string,
  limit: number | null = null,
): Promise<Result<readonly SearchHit[]>> {
  const normalized = query.trim();
  if (normalized === '') return Promise.resolve(ok([]));
  return store.transact<Result<readonly SearchHit[]>>(
    actor,
    workspaceId,
    async (tx) => {
      const permitted = await permitRead(tx, actor, workspaceId);
      if (!permitted.ok) return permitted;
      return ok(await tx.search(normalized, searchLimit(limit)));
    },
  );
}

/** Lists accepted live notes that link to one readable accepted note. */
export function getBacklinks(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  fileId: string,
  limit: number | null = null,
): Promise<Result<readonly Backlink[]>> {
  return store.transact<Result<readonly Backlink[]>>(
    actor,
    workspaceId,
    async (tx) => {
      const permitted = await permitRead(tx, actor, workspaceId);
      if (!permitted.ok) return permitted;
      const target = await tx.file(fileId);
      if (target === null || target.deleted || target.headRevisionId === null)
        return fail('not_found', [fileId]);
      return ok(await tx.backlinks(fileId, searchLimit(limit)));
    },
  );
}
