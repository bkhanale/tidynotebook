/**
 * Verified actors and the workspace role and action matrix.
 *
 * A permission decision uses two independent facts: the account's current role
 * in the workspace, and the verified grants that the transport attached to the
 * request. Both must permit the action. A cookie session, an agent token, and
 * an MCP call therefore reach the same decision, and a token cannot widen what
 * a role permits.
 */
import { fail, ok, type Result } from '../files/model.ts';

/** A workspace membership role, from the most to the least permission. */
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

/** A permitted kind of operation inside one workspace. */
export type Action =
  'read' | 'write' | 'history' | 'share' | 'members' | 'purge';

/** The verified actions of one account in one workspace. */
export type Grant = {
  readonly workspaceId: string;
  readonly actions: readonly Action[];
};

/**
 * Marker of a verified actor.
 *
 * The marker keeps verified identity apart from user supplied input. A parsed
 * request body cannot carry this symbol, so it cannot be used where an `Actor`
 * is required. Only `verifyActor` creates the marker, and only the identity
 * adapter calls it after it has checked a session or a token. The package
 * entry point does not export the symbol, so no other package can build an
 * actor by hand. `tools/actor-brand/fixture.ts` proves the compile-time part
 * of this rule.
 */
export const verifiedActorMark: unique symbol = Symbol(
  'notesapp.verified-actor',
);

/**
 * An authenticated account and its verified grants.
 *
 * The grants are the scope that the transport proved. The current role comes
 * from storage inside the same transaction, because a role can change between
 * the moment a token was issued and the moment a change commits.
 */
export type Actor = {
  readonly accountId: string;
  readonly grants: readonly Grant[];
  readonly [verifiedActorMark]: true;
};

/**
 * The actions that each role permits.
 *
 * A viewer reads content and history. An editor also writes. An admin also
 * manages shares and membership. Only the owner can purge. Ownership transfer
 * and the last owner rule are workspace use cases; they require the `members`
 * action and the `owner` role, and they add their own checks.
 */
const roleActions: Readonly<Record<Role, readonly Action[]>> = {
  viewer: ['read', 'history'],
  editor: ['read', 'history', 'write'],
  admin: ['read', 'history', 'write', 'share', 'members'],
  owner: ['read', 'history', 'write', 'share', 'members', 'purge'],
};
/**
 * The same matrix, read by a plain string key.
 *
 * A role reaches this package from storage, so a value outside the union can
 * arrive when a database row holds an unexpected string. The lookup then finds
 * nothing and the decision is a denial instead of a thrown error.
 */
const actionsOfRole = new Map<string, readonly Action[]>(
  Object.entries(roleActions),
);
/** Every action, for the runtime check of a supplied grant. */
const knownActions = new Set<string>(roleActions.owner);

/**
 * Creates a verified actor.
 *
 * Call this only after the identity adapter has verified the session or the
 * token and has read the scope from it. The grants are copied, so a later
 * change to the caller's array cannot change a decision.
 *
 * The values are checked at run time as well, because the scope of a token can
 * come from stored JSON that no longer matches the current union. An empty
 * account identifier, an empty workspace identifier, or an unknown action
 * rejects the whole actor with `forbidden`. Nothing is dropped silently: a
 * partly understood scope must not become a smaller scope that then looks
 * verified.
 */
export function verifyActor(
  accountId: string,
  grants: readonly Grant[],
): Result<Actor> {
  if (accountId.length === 0) return fail('forbidden');
  const copied: Grant[] = [];
  for (const grant of grants) {
    if (grant.workspaceId.length === 0) return fail('forbidden');
    for (const action of grant.actions) {
      if (!knownActions.has(action)) return fail('forbidden');
    }
    copied.push({
      workspaceId: grant.workspaceId,
      actions: [...grant.actions],
    });
  }
  return ok({
    accountId,
    grants: copied,
    [verifiedActorMark]: true,
  });
}

/**
 * The actions that one role permits.
 *
 * The identity adapter uses this to build the grants of a browser session,
 * which carries the full role, and to narrow the stored scope of an agent
 * token to the actions the current role still permits. A role outside the
 * union returns no action, so an unexpected stored value denies everything.
 */
export function actionsForRole(role: Role): readonly Action[] {
  return actionsOfRole.get(role) ?? [];
}

/**
 * Decides whether the actor may perform the action in the workspace.
 *
 * The decision is the intersection of the current role and the verified grants
 * for that workspace. A grant for another workspace never applies. The failure
 * is `forbidden` with no file identifiers, so the answer does not disclose
 * which files exist.
 */
export function authorize(
  actor: Actor,
  workspaceId: string,
  role: Role,
  action: Action,
): Result<void> {
  const permitted = actionsOfRole.get(role) ?? [];
  if (!permitted.includes(action)) return fail('forbidden');
  const grant = actor.grants.find((entry) => entry.workspaceId === workspaceId);
  if (grant === undefined || !grant.actions.includes(action))
    return fail('forbidden');
  return ok(undefined);
}
