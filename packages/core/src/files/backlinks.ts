/** Permission checked reads of the accepted path-based link index. */
import { authorize, type Actor } from '../identity/actor.ts';
import { fail, ok, type Result } from './model.ts';
import type { WorkspaceStore } from './ports.ts';

export type Backlink = {
  readonly fileId: string;
  readonly path: string;
  readonly revisionId: string;
};

/** Lists live notes that link to the current path of one live file. */
export function listBacklinks(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  fileId: string,
): Promise<Result<readonly Backlink[]>> {
  return store.transact<Result<readonly Backlink[]>>(
    actor,
    workspaceId,
    async (tx) => {
      const role = await tx.role(actor.accountId);
      if (role === null) return fail('forbidden');
      const permitted = authorize(actor, workspaceId, role, 'read');
      if (!permitted.ok) return permitted;
      const target = await tx.file(fileId);
      if (target === null || target.deleted || target.headRevisionId === null)
        return fail('not_found', [fileId]);
      return ok(await tx.backlinks(target.path, 100));
    },
    { readOnly: true },
  );
}
