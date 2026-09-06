/** Permission checked management of pinned public note revisions. */
import { authorize, type Actor } from '../identity/actor.ts';
import { fail, ok, type Result } from '../files/model.ts';
import type {
  ShareRecord,
  WorkspaceStore,
  WorkspaceTransaction,
} from '../files/ports.ts';

/** Values needed to create a link. The transport generates the secret token. */
export type CreateShareInput = {
  readonly id: string;
  readonly fileId: string;
  readonly pinnedRevisionId: string;
  readonly tokenHash: string;
  readonly expiresAt: string | null;
};

/** Values changed only after an explicit publication update. */
export type UpdateShareInput = {
  readonly shareId: string;
  readonly fileId: string;
  readonly pinnedRevisionId: string;
  readonly expiresAt: string | null;
};

/** Checks the current role and the verified share grant. */
async function permitShare(
  tx: WorkspaceTransaction,
  actor: Actor,
  workspaceId: string,
): Promise<Result<void>> {
  const role = await tx.role(actor.accountId);
  if (role === null) return fail('forbidden');
  return authorize(actor, workspaceId, role, 'share');
}

/** A valid optional future expiry, normalized to an ISO timestamp. */
function expiry(value: string | null, now: Date): Result<string | null> {
  if (value === null) return ok(null);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed <= now)
    return fail('invalid_content');
  return ok(parsed.toISOString());
}

/** Creates a link to an accepted note revision. */
export function createShare(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  input: CreateShareInput,
  now: Date = new Date(),
): Promise<Result<ShareRecord>> {
  return store.transact(actor, workspaceId, async (tx) => {
    const permitted = await permitShare(tx, actor, workspaceId);
    if (!permitted.ok) return fail(permitted.error.code);
    const expiresAt = expiry(input.expiresAt, now);
    if (!expiresAt.ok) return fail(expiresAt.error.code);
    const file = await tx.file(input.fileId);
    if (file === null || file.deleted || file.kind !== 'note')
      return fail('not_found', [input.fileId]);
    if (!(await tx.isAcceptedRevision(input.fileId, input.pinnedRevisionId)))
      return fail('not_found', [input.fileId]);
    return ok(
      await tx.createShare({
        ...input,
        creatorAccountId: actor.accountId,
        expiresAt: expiresAt.value,
      }),
    );
  });
}

/** Explicitly changes the pinned accepted revision and optional expiry. */
export function updateShare(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  input: UpdateShareInput,
  now: Date = new Date(),
): Promise<Result<ShareRecord>> {
  return store.transact(actor, workspaceId, async (tx) => {
    const permitted = await permitShare(tx, actor, workspaceId);
    if (!permitted.ok) return fail(permitted.error.code);
    const expiresAt = expiry(input.expiresAt, now);
    if (!expiresAt.ok) return fail(expiresAt.error.code);
    const file = await tx.file(input.fileId);
    if (file === null || file.deleted || file.kind !== 'note')
      return fail('not_found', [input.fileId]);
    if (!(await tx.isAcceptedRevision(input.fileId, input.pinnedRevisionId)))
      return fail('not_found', [input.fileId]);
    const updated = await tx.updateShare(
      input.shareId,
      input.fileId,
      input.pinnedRevisionId,
      expiresAt.value,
    );
    return updated === null ? fail('not_found') : ok(updated);
  });
}

/** Revokes a public link without deleting its audit record. */
export function revokeShare(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  shareId: string,
): Promise<Result<ShareRecord>> {
  return store.transact(actor, workspaceId, async (tx) => {
    const permitted = await permitShare(tx, actor, workspaceId);
    if (!permitted.ok) return fail(permitted.error.code);
    const revoked = await tx.revokeShare(shareId);
    return revoked === null ? fail('not_found') : ok(revoked);
  });
}

/** Lists public links for an administrator of one workspace. */
export function listShares(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
): Promise<Result<readonly ShareRecord[]>> {
  return store.transact(actor, workspaceId, async (tx) => {
    const permitted = await permitShare(tx, actor, workspaceId);
    if (!permitted.ok) return fail(permitted.error.code);
    return ok(await tx.listShares());
  });
}
