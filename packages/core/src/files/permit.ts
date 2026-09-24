/**
 * The read check that every read use case of a workspace passes.
 *
 * A read passes two checks: the current role of the account in the
 * workspace, and the verified grants of the transport. Both must permit the
 * `read` action. One function holds the pair, so a use case cannot check one
 * of them and forget the other.
 */
import { authorize, type Actor } from '../identity/actor.ts';
import { fail, type Result } from './model.ts';
import type { WorkspaceTransaction } from './ports.ts';

/** Checks that the actor may read this workspace. */
export async function permitRead(
  tx: Pick<WorkspaceTransaction, 'role'>,
  actor: Actor,
  workspaceId: string,
): Promise<Result<void>> {
  const role = await tx.role(actor.accountId);
  if (role === null) return fail('forbidden');
  return authorize(actor, workspaceId, role, 'read');
}
