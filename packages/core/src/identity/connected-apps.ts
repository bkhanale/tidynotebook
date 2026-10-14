/** A consent is an account credential control (record 0226). */
import { fail, ok, type Result } from '../files/model.ts';
import type { Actor } from './actor.ts';
import type { WorkspaceAdminStore } from '../workspaces/ports.ts';

export type ConnectedAppRecord = {
  readonly grantId: string;
  readonly clientId: string;
  readonly clientName: string | null;
  readonly scopes: readonly ('notes:read' | 'notes:write')[];
  readonly lastUsedAt: string | null;
};

export function listConnectedApps(
  store: WorkspaceAdminStore,
  actor: Actor,
): Promise<Result<readonly ConnectedAppRecord[]>> {
  return store.account(actor, async (tx) => ok(await tx.connectedApps()));
}

export function revokeConnectedApp(
  store: WorkspaceAdminStore,
  actor: Actor,
  grantId: string,
): Promise<Result<void>> {
  return store.account(actor, async (tx) =>
    (await tx.revokeConnectedApp(grantId)) ? ok(undefined) : fail('not_found'),
  );
}
