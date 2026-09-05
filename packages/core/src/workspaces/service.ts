/**
 * Account, workspace, and membership use cases.
 *
 * Every rule of the design lives here: who may change membership, that the
 * last owner cannot be removed or demoted, that ownership moves only through
 * an explicit transfer, and that an agent token can never be wider than the
 * role of the account that created it.
 *
 * A use case receives a verified actor and a store. It reads the current role
 * inside the same transaction that performs the write, because a role can
 * change between the moment a request arrives and the moment it commits. The
 * workspace transaction holds the same lock as a content write, so a role
 * change and a write of one workspace have a defined order.
 *
 * Expected failures are returned as `Result`. `forbidden` covers both a denied
 * permission and a denied rule, so an answer never tells a stranger which
 * workspace or account exists.
 */
import type { Action, Actor, Role } from '../identity/actor.ts';
import { actionsForRole, authorize } from '../identity/actor.ts';
import { fail, ok, type Result } from '../files/model.ts';
import type {
  AgentTokenSummary,
  InvitationSummary,
  Member,
  Preferences,
  ThemeChoice,
  TokenScope,
  WorkspaceAdminStore,
  WorkspaceSummary,
} from './ports.ts';

/** The longest life of an agent token, in milliseconds. One year. */
export const maxAgentTokenLifetimeMs = 365 * 24 * 60 * 60 * 1000;

/** The longest life of an invitation, in milliseconds. Fourteen days. */
export const invitationLifetimeMs = 14 * 24 * 60 * 60 * 1000;

/** The theme choices, for a transport that has to narrow an unknown value. */
export const themeChoices: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** The roles that may be granted through an invitation or a role change. */
const assignableRoles: readonly Role[] = ['admin', 'editor', 'viewer'];

/** True when the role manages membership. */
function manages(role: Role | null): boolean {
  return role === 'owner' || role === 'admin';
}

/** The members that hold the owner role. */
function owners(members: readonly Member[]): readonly Member[] {
  return members.filter((member) => member.role === 'owner');
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
    await tx.audit(input.workspaceId, {
      action: 'workspace.create',
      targetKind: 'workspace',
      targetId: input.workspaceId,
    });
    return ok({
      workspaceId: input.workspaceId,
      name: input.name,
      role: 'owner' as const,
      personal: false,
    });
  });
}

/** Renames a workspace. An administrator or the owner may do this. */
export function updateWorkspace(
  store: WorkspaceAdminStore,
  actor: Actor,
  workspaceId: string,
  name: string,
): Promise<Result<WorkspaceSummary>> {
  return store.workspace(actor, workspaceId, async (tx) => {
    const role = await tx.role(actor.accountId);
    const allowed = permit(actor, workspaceId, role, 'members');
    if (!allowed.ok) return fail<WorkspaceSummary>(allowed.error.code);
    if (!manages(role)) return fail<WorkspaceSummary>('forbidden');
    await tx.rename(name);
    await tx.audit({
      action: 'workspace.rename',
      targetKind: 'workspace',
      targetId: workspaceId,
    });
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
 * so every session loses its access to the workspace, and it removes the
 * shares, so no public link survives. Attachment bytes on the private volume
 * are reclaimed by the cleanup job that owns them.
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
    // The record of the deletion goes to another workspace of the actor,
    // because `destroy` removes the audit rows of this one.
    await tx.auditActorHome({ action: 'workspace.delete' });
    await tx.destroy();
    return ok(undefined);
  });
}

/** The members and the open invitations of a workspace. */
export function listMembers(
  store: WorkspaceAdminStore,
  actor: Actor,
  workspaceId: string,
): Promise<
  Result<{
    readonly members: readonly Member[];
    readonly invitations: readonly InvitationSummary[];
  }>
> {
  return store.workspace(actor, workspaceId, async (tx) => {
    const role = await tx.role(actor.accountId);
    const allowed = permit(actor, workspaceId, role, 'read');
    if (!allowed.ok)
      return fail<{
        readonly members: readonly Member[];
        readonly invitations: readonly InvitationSummary[];
      }>(allowed.error.code);
    const members = await tx.members();
    const invitations = manages(role) ? await tx.invitations() : [];
    return ok({ members, invitations });
  });
}

/**
 * Invites an address to a workspace.
 *
 * The invitation names a role that an administrator may grant, so an
 * invitation can never create a second owner. Only the hash of the token
 * reaches storage. The caller delivers the token by email, or hands it to the
 * inviting administrator when the deployment has no mail transport.
 */
export function inviteMember(
  store: WorkspaceAdminStore,
  actor: Actor,
  workspaceId: string,
  input: {
    readonly id: string;
    readonly email: string;
    readonly role: Role;
    readonly tokenHash: string;
    readonly expiresAt: string;
  },
): Promise<Result<InvitationSummary>> {
  return store.workspace(actor, workspaceId, async (tx) => {
    const role = await tx.role(actor.accountId);
    const allowed = permit(actor, workspaceId, role, 'members');
    if (!allowed.ok) return fail<InvitationSummary>(allowed.error.code);
    if (!manages(role)) return fail<InvitationSummary>('forbidden');
    if (!assignableRoles.includes(input.role))
      return fail<InvitationSummary>('forbidden');
    await tx.createInvitation({
      id: input.id,
      email: input.email,
      role: input.role,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });
    await tx.audit({
      action: 'membership.invite',
      targetKind: 'invitation',
      targetId: input.id,
    });
    return ok({
      id: input.id,
      workspaceId,
      email: input.email,
      role: input.role,
      expiresAt: input.expiresAt,
      state: 'pending' as const,
    });
  });
}

/**
 * Accepts an invitation.
 *
 * The store consumes the invitation atomically, so a replay of the same token
 * finds nothing and the answer is `not_found`. The address of the accepting
 * account must match the invited address, so a leaked token cannot admit a
 * different account.
 */
export function acceptInvitation(
  store: WorkspaceAdminStore,
  actor: Actor,
  input: { readonly tokenHash: string; readonly email: string },
): Promise<Result<{ workspaceId: string; role: Role }>> {
  return store.account(actor, async (tx) => {
    // The store takes the workspace lock of the invitation before it consumes
    // it, so acceptance is ordered with every other membership write.
    const claimed = await tx.claimInvitation(input);
    if (claimed === null)
      return fail<{ workspaceId: string; role: Role }>('not_found');
    await tx.recordMembershipChange(claimed.workspaceId, {
      accountId: actor.accountId,
      removed: false,
    });
    await tx.audit(claimed.workspaceId, {
      action: 'membership.accept',
      targetKind: 'account',
      targetId: actor.accountId,
    });
    return ok(claimed);
  });
}

/**
 * Changes the role of a member.
 *
 * An owner's role never changes here: ownership moves only through an explicit
 * transfer, so a workspace cannot lose its last owner by a role edit. Nobody
 * changes their own role, and nobody grants the owner role.
 */
export function updateMember(
  store: WorkspaceAdminStore,
  actor: Actor,
  workspaceId: string,
  accountId: string,
  role: Role,
): Promise<Result<Member>> {
  return store.workspace(actor, workspaceId, async (tx) => {
    const current = await tx.role(actor.accountId);
    const allowed = permit(actor, workspaceId, current, 'members');
    if (!allowed.ok) return fail<Member>(allowed.error.code);
    if (!manages(current)) return fail<Member>('forbidden');
    if (accountId === actor.accountId) return fail<Member>('forbidden');
    if (!assignableRoles.includes(role)) return fail<Member>('forbidden');
    const members = await tx.members();
    const target = members.find((member) => member.accountId === accountId);
    if (target === undefined) return fail<Member>('not_found');
    // An owner keeps the owner role until an explicit transfer moves it. This
    // is what prevents the demotion of the last owner.
    if (target.role === 'owner') return fail<Member>('forbidden');
    await tx.setRole(accountId, role);
    await tx.recordMembershipChange({ accountId, removed: false });
    await tx.audit({
      action: 'membership.role',
      targetKind: 'account',
      targetId: accountId,
    });
    return ok({ ...target, role });
  });
}

/**
 * Removes a member.
 *
 * The last owner cannot be removed, and only another owner may remove an
 * owner. An account does not remove itself here; an owner who wants to leave
 * uses a transfer with `leave`.
 */
export function removeMember(
  store: WorkspaceAdminStore,
  actor: Actor,
  workspaceId: string,
  accountId: string,
): Promise<Result<void>> {
  return store.workspace(actor, workspaceId, async (tx) => {
    const current = await tx.role(actor.accountId);
    const allowed = permit(actor, workspaceId, current, 'members');
    if (!allowed.ok) return fail<void>(allowed.error.code);
    if (!manages(current)) return fail<void>('forbidden');
    if (accountId === actor.accountId) return fail<void>('forbidden');
    const members = await tx.members();
    const target = members.find((member) => member.accountId === accountId);
    if (target === undefined) return fail<void>('not_found');
    if (target.role === 'owner') {
      if (current !== 'owner') return fail<void>('forbidden');
      if (owners(members).length <= 1) return fail<void>('forbidden');
    }
    const removed = await tx.removeMember(accountId);
    if (!removed) return fail<void>('not_found');
    await tx.recordMembershipChange({ accountId, removed: true });
    await tx.audit({
      action: 'membership.remove',
      targetKind: 'account',
      targetId: accountId,
    });
    return ok(undefined);
  });
}

/**
 * Moves ownership to another member.
 *
 * Only an owner may do this, and the new owner must already be a member. The
 * old owner becomes an administrator, or leaves the workspace when the caller
 * asks for it. The store performs both changes in one statement, so the
 * workspace always has an owner.
 */
export function transferOwnership(
  store: WorkspaceAdminStore,
  actor: Actor,
  workspaceId: string,
  input: { readonly accountId: string; readonly leave: boolean },
): Promise<Result<readonly Member[]>> {
  return store.workspace(actor, workspaceId, async (tx) => {
    const current = await tx.role(actor.accountId);
    const allowed = permit(actor, workspaceId, current, 'members');
    if (!allowed.ok) return fail<readonly Member[]>(allowed.error.code);
    if (current !== 'owner') return fail<readonly Member[]>('forbidden');
    if (input.accountId === actor.accountId)
      return fail<readonly Member[]>('forbidden');
    const members = await tx.members();
    const target = members.find(
      (member) => member.accountId === input.accountId,
    );
    if (target === undefined) return fail<readonly Member[]>('not_found');
    await tx.transferOwnership(input.accountId, input.leave);
    await tx.recordMembershipChange({
      accountId: input.accountId,
      removed: false,
    });
    await tx.recordMembershipChange({
      accountId: actor.accountId,
      removed: input.leave,
    });
    await tx.audit({
      action: 'workspace.transfer',
      targetKind: 'account',
      targetId: input.accountId,
    });
    return ok(
      members.flatMap((member) => {
        if (member.accountId === input.accountId)
          return [{ ...member, role: 'owner' as const }];
        if (member.accountId !== actor.accountId) return [member];
        return input.leave ? [] : [{ ...member, role: 'admin' as const }];
      }),
    );
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
    if (!themeChoices.includes(preferences.theme))
      return fail<Preferences>('forbidden');
    await tx.savePreferences(preferences);
    return ok(preferences);
  });
}

/** Every agent token of the account, without secrets. */
export function listAgentTokens(
  store: WorkspaceAdminStore,
  actor: Actor,
): Promise<Result<readonly AgentTokenSummary[]>> {
  return store.account(actor, async (tx) => ok(await tx.agentTokens()));
}

/**
 * Narrows a requested token scope to what the account may actually delegate.
 *
 * A token can never widen a role: every requested action must be permitted by
 * the current role in that workspace and by the grants of the actor that
 * creates the token. A scope that names a workspace the account does not
 * belong to, or an action its role does not permit, rejects the whole request
 * instead of quietly shrinking it.
 */
export function checkTokenScopes(
  actor: Actor,
  scopes: readonly TokenScope[],
  memberships: readonly { workspaceId: string; role: Role }[],
): Result<readonly TokenScope[]> {
  if (scopes.length === 0) return fail('forbidden');
  const roles = new Map(
    memberships.map((entry) => [entry.workspaceId, entry.role]),
  );
  const checked: TokenScope[] = [];
  for (const scope of scopes) {
    const role = roles.get(scope.workspaceId);
    if (role === undefined) return fail('forbidden');
    if (scope.actions.length === 0) return fail('forbidden');
    const permitted = actionsForRole(role);
    for (const action of scope.actions) {
      if (!permitted.includes(action)) return fail('forbidden');
      if (!authorize(actor, scope.workspaceId, role, action).ok)
        return fail('forbidden');
    }
    checked.push({
      workspaceId: scope.workspaceId,
      actions: [...scope.actions],
    });
  }
  return ok(checked);
}

/**
 * Creates an agent token.
 *
 * The secret is created by the caller, which owns the random source and the
 * hash, and it is returned to the caller once. Storage keeps the hash only.
 * An expiry is required and can never be more than one year away.
 */
export function createAgentToken(
  store: WorkspaceAdminStore,
  actor: Actor,
  input: {
    readonly id: string;
    readonly name: string;
    readonly prefix: string;
    readonly secretHash: string;
    readonly scopes: readonly TokenScope[];
    readonly expiresAt: string;
    readonly now: Date;
  },
): Promise<Result<AgentTokenSummary>> {
  return store.account(actor, async (tx) => {
    const expiry = Date.parse(input.expiresAt);
    if (Number.isNaN(expiry)) return fail<AgentTokenSummary>('forbidden');
    const life = expiry - input.now.getTime();
    if (life <= 0 || life > maxAgentTokenLifetimeMs)
      return fail<AgentTokenSummary>('forbidden');
    const scopes = checkTokenScopes(
      actor,
      input.scopes,
      await tx.memberships(),
    );
    if (!scopes.ok) return fail<AgentTokenSummary>(scopes.error.code);
    await tx.createAgentToken({
      id: input.id,
      name: input.name,
      prefix: input.prefix,
      secretHash: input.secretHash,
      scopes: scopes.value,
      expiresAt: input.expiresAt,
    });
    return ok({
      id: input.id,
      name: input.name,
      prefix: input.prefix,
      scopes: scopes.value,
      expiresAt: input.expiresAt,
      createdAt: input.now.toISOString(),
      revokedAt: null,
    });
  });
}

/** Revokes one agent token of the account. */
export function revokeAgentToken(
  store: WorkspaceAdminStore,
  actor: Actor,
  tokenId: string,
): Promise<Result<void>> {
  return store.account(actor, async (tx) => {
    const revoked = await tx.revokeAgentToken(tokenId);
    return revoked ? ok(undefined) : fail<void>('not_found');
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

/**
 * The grants of an agent token.
 *
 * The token's stored scope is intersected with the current role in each
 * workspace, so a token cannot outlive the membership that justified it. A
 * scope for a workspace the account has left disappears completely.
 */
export function tokenGrants(
  scopes: readonly TokenScope[],
  memberships: readonly { workspaceId: string; role: Role }[],
): readonly { workspaceId: string; actions: readonly Action[] }[] {
  const roles = new Map(
    memberships.map((entry) => [entry.workspaceId, entry.role]),
  );
  return scopes.flatMap((scope) => {
    const role = roles.get(scope.workspaceId);
    if (role === undefined) return [];
    const permitted = actionsForRole(role);
    const actions = scope.actions.filter((action) =>
      permitted.includes(action),
    );
    return actions.length === 0
      ? []
      : [{ workspaceId: scope.workspaceId, actions }];
  });
}
