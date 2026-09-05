/**
 * Storage ports for accounts, workspaces, membership, and agent tokens.
 *
 * The core owns these interfaces; the server storage package implements them.
 * They stay free of a database driver and an HTTP framework, so the rules in
 * `service.ts` can be tested with a plain in-memory double.
 *
 * There are two entry points, because the two kinds of change need different
 * locks. An account scoped change touches one account and creates a workspace
 * that no other transaction can see yet. A workspace scoped change touches
 * membership, so it takes the same workspace lock as a content write. A role
 * change and a content write of one workspace therefore have a defined order.
 */
import type { Action, Actor, Role } from '../identity/actor.ts';

/** The three theme choices that an account can store. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** Settings that follow an account to every device. */
export type Preferences = {
  readonly theme: ThemeChoice;
};

/** One workspace as its member sees it. */
export type WorkspaceSummary = {
  readonly workspaceId: string;
  readonly name: string;
  /** The role of the reading account in this workspace. */
  readonly role: Role;
  /** True for the workspace that was created with the account. */
  readonly personal: boolean;
};

/** One member of one workspace. */
export type Member = {
  readonly accountId: string;
  readonly role: Role;
  /** Sign-in address of the member, or `null` when no identity is linked. */
  readonly email: string | null;
  /** Display name of the member, or `null` when no identity is linked. */
  readonly name: string | null;
};

/** The state of one invitation. */
export type InvitationState = 'pending' | 'accepted' | 'revoked';

/** One invitation to one workspace. The token itself is never stored. */
export type InvitationSummary = {
  readonly id: string;
  readonly workspaceId: string;
  readonly email: string;
  readonly role: Role;
  readonly expiresAt: string;
  readonly state: InvitationState;
};

/** The workspace and the actions that one agent token may use. */
export type TokenScope = {
  readonly workspaceId: string;
  readonly actions: readonly Action[];
};

/** One agent token without its secret. */
export type AgentTokenSummary = {
  readonly id: string;
  readonly name: string;
  /** Short public prefix of the secret, used to name a token in a list. */
  readonly prefix: string;
  readonly scopes: readonly TokenScope[];
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
};

/** A stored agent token that a bearer request resolved. */
export type AgentTokenRecord = {
  readonly id: string;
  readonly accountId: string;
  readonly scopes: readonly TokenScope[];
  readonly expiresAt: string;
  readonly revokedAt: string | null;
};

/** What one new agent token needs. The secret never reaches storage. */
export type AgentTokenInput = {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly secretHash: string;
  readonly scopes: readonly TokenScope[];
  readonly expiresAt: string;
};

/** What one new invitation needs. Only the hash of its token is stored. */
export type InvitationInput = {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  readonly tokenHash: string;
  readonly expiresAt: string;
};

/**
 * Reads and writes that belong to one account.
 *
 * Every call is bound to the actor that opened the transaction. There is no
 * account argument, so a use case cannot read another account's rows by
 * mistake.
 */
export type AccountTransaction = {
  /** Every workspace of the account, with the account's role in each. */
  workspaces(): Promise<readonly WorkspaceSummary[]>;
  /** The current role of the account in each of its workspaces. */
  memberships(): Promise<readonly { workspaceId: string; role: Role }[]>;
  /** The stored settings of the account. */
  preferences(): Promise<Preferences>;
  /** Replaces the stored settings of the account. */
  savePreferences(preferences: Preferences): Promise<void>;
  /**
   * Creates a workspace whose only member is the account, as its owner.
   *
   * The call takes the same workspace lock as every other write of that
   * workspace, so the first membership record is ordered with the rest.
   */
  createWorkspace(input: {
    readonly workspaceId: string;
    readonly name: string;
  }): Promise<void>;
  /** Takes the workspace lock inside this transaction. */
  lockWorkspace(workspaceId: string): Promise<void>;
  /** Appends one content free audit record to a workspace. */
  audit(
    workspaceId: string,
    input: {
      readonly action: string;
      readonly targetKind: string;
      readonly targetId: string | null;
    },
  ): Promise<void>;
  /** Appends one incremental membership record under the workspace lock. */
  recordMembershipChange(
    workspaceId: string,
    input: { readonly accountId: string; readonly removed: boolean },
  ): Promise<void>;
  /** Every agent token of the account, without secrets. */
  agentTokens(): Promise<readonly AgentTokenSummary[]>;
  /** Stores one new agent token. */
  createAgentToken(input: AgentTokenInput): Promise<void>;
  /** Revokes one agent token of the account. False when it does not exist. */
  revokeAgentToken(tokenId: string): Promise<boolean>;
  /**
   * The workspace and the invited address of one open invitation, or `null`.
   *
   * The invitation is not consumed. Acceptance uses the workspace to take its
   * lock, and the sign-up path uses the address to create a local account for
   * a person who has none.
   */
  openInvitation(tokenHash: string): Promise<{
    workspaceId: string;
    email: string;
  } | null>;
  /**
   * Consumes one invitation for the account.
   *
   * The call is atomic: the first caller receives the workspace and the role,
   * and every later caller receives `null`. An expired, revoked, already
   * accepted, or foreign address invitation also returns `null`, so a replay
   * cannot grant membership twice.
   */
  claimInvitation(input: {
    readonly tokenHash: string;
    readonly email: string;
  }): Promise<{ workspaceId: string; role: Role } | null>;
};

/**
 * Reads and writes of one workspace, under the workspace lock.
 *
 * The lock is the same one that a content write takes, so a role change and a
 * content write of one workspace cannot interleave.
 */
export type WorkspaceAdminTransaction = {
  /** The name of the workspace and whether it is a personal one. */
  describe(): Promise<{ name: string; personal: boolean } | null>;
  /** The current role of one account, or `null` for a stranger. */
  role(accountId: string): Promise<Role | null>;
  /** Every member of the workspace. */
  members(): Promise<readonly Member[]>;
  /** Every invitation of the workspace. */
  invitations(): Promise<readonly InvitationSummary[]>;
  /** Renames the workspace. */
  rename(name: string): Promise<void>;
  /** Deletes the workspace and every record that belongs to it. */
  destroy(): Promise<void>;
  /** Changes the role of one existing member. */
  setRole(accountId: string, role: Role): Promise<void>;
  /** Removes one member. False when the account is not a member. */
  removeMember(accountId: string): Promise<boolean>;
  /**
   * Moves ownership to another member.
   *
   * The old owner becomes an administrator, or leaves the workspace when
   * `leave` is true. The call is one statement, so the workspace always has an
   * owner.
   */
  transferOwnership(accountId: string, leave: boolean): Promise<void>;
  /** Stores one new invitation. */
  createInvitation(input: InvitationInput): Promise<void>;
  /** Appends one content free audit record. */
  audit(input: {
    readonly action: string;
    readonly targetKind: string;
    readonly targetId: string | null;
  }): Promise<void>;
  /**
   * Appends one audit record to the account trail of the actor.
   *
   * Deleting a workspace removes its own audit rows, so the record of that
   * deletion cannot live in the workspace it describes. The account trail is
   * not scoped by a workspace, so the record survives even when the deleted
   * workspace was the actor's last one. The deleted workspace identifier is
   * the content free target.
   */
  auditAccount(input: { readonly action: string }): Promise<void>;
  /** Appends one incremental change record under the workspace lock. */
  recordMembershipChange(input: {
    readonly accountId: string;
    readonly removed: boolean;
  }): Promise<void>;
};

/** Opens the transactions that the account and workspace use cases need. */
export type WorkspaceAdminStore = {
  /** Runs `run` in one transaction bound to the actor's account. */
  account<T>(
    actor: Actor,
    run: (tx: AccountTransaction) => Promise<T>,
  ): Promise<T>;
  /**
   * Runs `run` in one transaction that holds the workspace lock. The call
   * fails with `WorkspaceUnavailableError` when the workspace does not exist
   * or the actor cannot see it.
   */
  workspace<T>(
    actor: Actor,
    workspaceId: string,
    run: (tx: WorkspaceAdminTransaction) => Promise<T>,
  ): Promise<T>;
};
