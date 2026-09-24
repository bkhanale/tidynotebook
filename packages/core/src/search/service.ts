/**
 * Permission checked workspace search use cases.
 *
 * Storage owns the text index. The core owns the read permission check, result
 * limits, and the public result shapes. This keeps database rows out of HTTP
 * responses and applies the same role and token grant intersection as normal
 * file reads.
 */
import type { Actor } from '../identity/actor.ts';
import { ok, type Result } from '../files/model.ts';
import { permitRead } from '../files/permit.ts';
import type { WorkspaceStore } from '../files/ports.ts';

/**
 * One part of a search excerpt.
 *
 * A marked part is a word that the query matched. The excerpt carries no
 * markup, so a reading surface renders every part as text and decides for
 * itself how a marked part looks.
 */
export type ExcerptPart = {
  readonly text: string;
  readonly marked: boolean;
};

/** One accepted note that matched a search query. */
export type SearchHit = {
  readonly fileId: string;
  readonly path: string;
  readonly revisionId: string;
  readonly excerpt: readonly ExcerptPart[];
};

/** Default and maximum result counts at the domain boundary. */
export const defaultSearchLimit = 50;
export const maxSearchLimit = 100;

/** Keeps a requested result count inside the served range. */
export function searchLimit(limit: number | null): number {
  if (limit === null || !Number.isFinite(limit)) return defaultSearchLimit;
  return Math.min(Math.max(1, Math.trunc(limit)), maxSearchLimit);
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
    { readOnly: true },
  );
}
