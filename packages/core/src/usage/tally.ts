/**
 * The sums of one process that are not stored yet (record 0193).
 *
 * A database write for each answer would make each answer cost a write, so
 * each process adds its counts to a sum in memory for each account and for
 * the installation, and writes the sums to the monthly table every `10 s`.
 *
 * `take` hands the sums to that write and starts new ones. The sums of a
 * write stay in `pending` until `settle` states how the write ended, so a
 * check never misses a count while the write runs. A write that failed gives
 * its sums back, so it loses no count. A count belongs to the month in which
 * it happened, so a write after the end of a month still adds it to that
 * month.
 *
 * Two errors of one interval are accepted, as record 0193 accepts that
 * processes pass a limit by the traffic of one interval:
 *
 * - A check whose stored read starts after a write commits, and ends before
 *   this process reads the answer of that write, counts the sums of the
 *   write twice until `settle` runs. The error is at most one interval of
 *   this process, it lasts for one answer, and it closes early and never
 *   late. Only the database knows when a write commits, so the process
 *   cannot tell this read apart from a read before the commit.
 * - A write whose commit succeeds and whose answer is lost reads as failed,
 *   so its sums go to the next write and are stored twice. The error is at
 *   most one interval of this process, and it closes early and never late.
 */
import { isZero, sumCounts, zeroCounts, type MonthlyCounts } from './model.ts';

/**
 * The sum of one month for one account, or for the installation when
 * `accountId` is `null`.
 */
export type UsageEntry = {
  readonly month: string;
  readonly accountId: string | null;
  readonly counts: MonthlyCounts;
};

/** The sums of one process. */
export type UsageTally = {
  /**
   * Adds counts of one month. A count of an account adds to the sum of that
   * account and to the sum of the installation, and a count of no account
   * adds to the sum of the installation only.
   */
  add(month: string, accountId: string | null, counts: MonthlyCounts): void;
  /**
   * The sum that is not stored yet, for one account or the installation,
   * with the sums of a write that has not settled.
   */
  pending(month: string, accountId: string | null): MonthlyCounts;
  /** Answers every sum for one write and starts new sums. */
  take(): readonly UsageEntry[];
  /**
   * Ends one write of the sums that `take` answered. A write that stored
   * nothing gives them back to the next write.
   */
  settle(entries: readonly UsageEntry[], stored: boolean): void;
};

/** The key of one sum. The installation has no account. */
function keyOf(month: string, accountId: string | null): string {
  return `${month}/${accountId ?? ''}`;
}

/** Adds counts to one sum of a map. */
function addTo(
  sums: Map<string, UsageEntry>,
  month: string,
  accountId: string | null,
  counts: MonthlyCounts,
): void {
  if (isZero(counts)) return;
  const key = keyOf(month, accountId);
  const before = sums.get(key);
  sums.set(key, {
    month,
    accountId,
    counts: sumCounts(before?.counts ?? zeroCounts, counts),
  });
}

/** Makes the empty sums of one process. */
export function createUsageTally(): UsageTally {
  let sums = new Map<string, UsageEntry>();
  // The sums of each write that has not settled.
  const writes = new Set<readonly UsageEntry[]>();

  return {
    add(month, accountId, counts) {
      addTo(sums, month, null, counts);
      if (accountId !== null) addTo(sums, month, accountId, counts);
    },

    pending(month, accountId) {
      const key = keyOf(month, accountId);
      let total = sums.get(key)?.counts ?? zeroCounts;
      for (const write of writes)
        for (const entry of write)
          if (keyOf(entry.month, entry.accountId) === key)
            total = sumCounts(total, entry.counts);
      return total;
    },

    take() {
      const taken = [...sums.values()];
      sums = new Map();
      if (taken.length > 0) writes.add(taken);
      return taken;
    },

    settle(entries, stored) {
      if (!writes.delete(entries)) return;
      if (stored) return;
      for (const entry of entries)
        addTo(sums, entry.month, entry.accountId, entry.counts);
    },
  };
}
