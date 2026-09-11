/**
 * Account and workspace use cases.
 *
 * A use case receives a verified actor and a store. It reads the current role
 * inside the same transaction that performs the write, because a role can
 * change between the moment a request arrives and the moment it commits. The
 * workspace transaction holds the same lock as a content write, so a
 * workspace change and a write of one workspace have a defined order.
 *
 * Expected failures are returned as `Result`. `forbidden` covers both a denied
 * permission and a denied rule, so an answer never tells a stranger which
 * workspace or account exists.
 */
import type { Action, Actor, Role } from '../identity/actor.ts';
import { actionsForRole, authorize } from '../identity/actor.ts';
import { fail, ok, type Result } from '../files/model.ts';
import type {
  AppearanceChoice,
  Preferences,
  WorkspaceAdminStore,
  WorkspaceSummary,
} from './ports.ts';

/**
 * The appearance choices, for a transport that narrows an unknown value.
 */
export const appearanceChoices: readonly AppearanceChoice[] = [
  'system',
  'light',
  'dark',
];

/**
 * The shape a theme family identifier must have.
 *
 * The registry of families is a client concern, so the rule here is only the
 * slug shape and its length. A family the client does not know falls back to
 * the default one when the page paints.
 */
export const themeFamilyPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The longest theme family identifier the store accepts. */
export const themeFamilyMaximumLength = 40;

/** True when a value can be stored as a theme family identifier. */
export function isThemeFamilyId(value: string): boolean {
  return (
    value.length <= themeFamilyMaximumLength && themeFamilyPattern.test(value)
  );
}

/**
 * Both permission checks of one workspace action.
 *
 * The role comes from storage inside the open transaction. The grants come
 * from the transport that verified the request. Both must permit the action.
 */
function permit(
  actor: Actor,
  workspaceId: string,
  role: Role | null,
  action: Action,
): Result<Role> {
  if (role === null) return fail('forbidden');
  const decision = authorize(actor, workspaceId, role, action);
  return decision.ok ? ok(role) : fail('forbidden');
}

/** Every workspace of the account, with its role in each. */
export function listWorkspaces(
  store: WorkspaceAdminStore,
  actor: Actor,
): Promise<Result<readonly WorkspaceSummary[]>> {
  return store.account(actor, async (tx) => ok(await tx.workspaces()));
}

/**
 * Creates a workspace whose creator becomes its owner.
 *
 * Any authenticated account may create a workspace, because the new workspace
 * contains nothing that belongs to another account.
 */
export function createWorkspace(
  store: WorkspaceAdminStore,
  actor: Actor,
  input: { readonly workspaceId: string; readonly name: string },
): Promise<Result<WorkspaceSummary>> {
  return store.account(actor, async (tx) => {
    // The store takes the workspace lock before it creates anything, so the
    // owner membership row is recorded in the same order as every later
    // membership change of that workspace.
    await tx.createWorkspace(input);
    await tx.recordMembershipChange(input.workspaceId, {
      accountId: actor.accountId,
      removed: false,
    });
    return ok({
      workspaceId: input.workspaceId,
      name: input.name,
      role: 'owner' as const,
      personal: false,
    });
  });
}

/** Renames a workspace. Only the owner may do this. */
export function updateWorkspace(
  store: WorkspaceAdminStore,
  actor: Actor,
  workspaceId: string,
  name: string,
): Promise<Result<WorkspaceSummary>> {
  return store.workspace(actor, workspaceId, async (tx) => {
    const role = await tx.role(actor.accountId);
    const allowed = permit(actor, workspaceId, role, 'write');
    if (!allowed.ok) return fail<WorkspaceSummary>(allowed.error.code);
    if (role !== 'owner') return fail<WorkspaceSummary>('forbidden');
    await tx.rename(name);
    const described = await tx.describe();
    return ok({
      workspaceId,
      name,
      role: allowed.value,
      personal: described?.personal ?? false,
    });
  });
}

/**
 * Deletes a workspace and every record that belongs to it.
 *
 * Only the owner may do this. The storage call removes the membership rows,
 * so every session loses its access to the workspace. Attachment bytes on the
 * private volume are reclaimed by the cleanup job that owns them.
 */
export function deleteWorkspace(
  store: WorkspaceAdminStore,
  actor: Actor,
  workspaceId: string,
): Promise<Result<void>> {
  return store.workspace(actor, workspaceId, async (tx) => {
    const role = await tx.role(actor.accountId);
    const allowed = permit(actor, workspaceId, role, 'purge');
    if (!allowed.ok) return fail<void>(allowed.error.code);
    if (role !== 'owner') return fail<void>('forbidden');
    // The record of the deletion goes to the account trail, because `destroy`
    // removes every row of this workspace and the actor may have had no other
    // workspace at all.
    await tx.auditAccount({ action: 'workspace.delete' });
    await tx.destroy();
    return ok(undefined);
  });
}

/** The stored settings of the account. */
export function readPreferences(
  store: WorkspaceAdminStore,
  actor: Actor,
): Promise<Result<Preferences>> {
  return store.account(actor, async (tx) => ok(await tx.preferences()));
}

/** Replaces the stored settings of the account. */
export function updatePreferences(
  store: WorkspaceAdminStore,
  actor: Actor,
  preferences: Preferences,
): Promise<Result<Preferences>> {
  return store.account(actor, async (tx) => {
    if (!appearanceChoices.includes(preferences.appearance))
      return fail<Preferences>('forbidden');
    if (!isThemeFamilyId(preferences.themeFamily))
      return fail<Preferences>('forbidden');
    await tx.savePreferences(preferences);
    return ok(preferences);
  });
}

/**
 * The grants of a browser session.
 *
 * A cookie session carries the full role, so the grants are exactly the
 * actions of the current role in every workspace the account belongs to.
 */
export function sessionGrants(
  memberships: readonly { workspaceId: string; role: Role }[],
): readonly { workspaceId: string; actions: readonly Action[] }[] {
  return memberships.map((entry) => ({
    workspaceId: entry.workspaceId,
    actions: actionsForRole(entry.role),
  }));
}
