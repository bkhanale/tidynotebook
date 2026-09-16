/**
 * Storage ports for accounts and workspaces.
 *
 * The core owns these interfaces; the server storage package implements them.
 * They stay free of a database driver and an HTTP framework, so the rules in
 * `service.ts` can be tested with a plain in-memory double.
 *
 * There are two entry points, because the two kinds of change need different
 * locks. An account scoped change touches one account and creates a workspace
 * that no other transaction can see yet. A workspace scoped change takes the
 * same workspace lock as a content write, so the two have a defined order.
 */
import type { Actor, Role } from '../identity/actor.ts';

/** The three appearance choices that an account can store. */
export type AppearanceChoice = 'system' | 'light' | 'dark';

/**
 * Settings that follow an account to every device.
 *
 * `themeFamily` names a palette family of the client theme registry. The
 * server keeps the identifier as an opaque slug: the registry lives in the
 * browser package, and a server that knew the palette names would have to be
 * released again for every new theme.
 */
export type Preferences = {
  readonly appearance: AppearanceChoice;
  readonly themeFamily: string;
};

/**
 * Settings as a caller read them, before the appearance is checked.
 *
 * A preference reaches this package from a request body or from a stored row,
 * so the appearance can be a text that the union does not hold. A caller
 * states what it read and `updatePreferences` decides, instead of claiming a
 * shape that nothing proved.
 */
export type StoredPreferences = {
  readonly appearance: string;
  readonly themeFamily: string;
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
  /** Appends one incremental membership record under the workspace lock. */
  recordMembershipChange(
    workspaceId: string,
    input: { readonly accountId: string; readonly removed: boolean },
  ): Promise<void>;
};

/**
 * Reads and writes of one workspace, under the workspace lock.
 *
 * The lock is the same one that a content write takes, so a workspace change
 * and a content write of one workspace cannot interleave.
 */
export type WorkspaceAdminTransaction = {
  /** The name of the workspace and whether it is a personal one. */
  describe(): Promise<{ name: string; personal: boolean } | null>;
  /** The current role of one account, or `null` for a stranger. */
  role(accountId: string): Promise<Role | null>;
  /**
   * How many workspaces the account of this transaction belongs to.
   *
   * The count is read inside the transaction that deletes a workspace, under
   * the lock that transaction already holds, so two tabs that each delete one
   * of the last two workspaces cannot both pass the check.
   */
  accountWorkspaceCount(): Promise<number>;
  /** Renames the workspace. */
  rename(name: string): Promise<void>;
  /** Deletes the workspace and every record that belongs to it. */
  destroy(): Promise<void>;
  /**
   * Appends one audit record to the account trail of the actor.
   *
   * The trail is not scoped by a workspace, so the record of a deletion
   * survives even when the deleted workspace was the actor's last one. The
   * deleted workspace identifier is the content free target.
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
