/**
 * The store of the monthly counts (record 0193).
 *
 * `packages/storage-server` implements it over the one monthly table, which
 * holds one row for each account and one for the installation in each month.
 * Every process of an installation writes to that table, so a read of it is
 * the total of every process.
 */
import type { MonthlyCounts, TransferLimits } from './model.ts';
import type { UsageEntry } from './tally.ts';

/** An account that a limit holds, with its two limits. */
export type UsageSubject = {
  readonly accountId: string;
  readonly limits: TransferLimits;
};

/** Whom a count or a check names: an account, or the owner of a workspace. */
export type UsageSubjectKey =
  { readonly accountId: string } | { readonly workspaceId: string };

/** The stored totals of one month for one account and for the installation. */
export type StoredUsage = {
  readonly account: MonthlyCounts;
  readonly installation: MonthlyCounts;
};

export type MonthlyUsageStore = {
  /**
   * Adds every entry to its row in one transaction, so a failure adds none.
   * An entry of an account that does not exist adds nothing.
   */
  addUsage(entries: readonly UsageEntry[]): Promise<void>;
  /**
   * The account and its limits, or the owner of the workspace and its
   * limits, or `null` when there is none.
   */
  usageSubject(key: UsageSubjectKey): Promise<UsageSubject | null>;
  /**
   * The stored totals of one month `YYYY-MM`. With no account, the account
   * totals are zero.
   */
  storedUsage(month: string, accountId: string | null): Promise<StoredUsage>;
};
