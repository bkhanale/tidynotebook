/**
 * The meter of one process (record 0193): it counts, it checks, and it
 * writes its sums.
 *
 * A check reads the stored total of the month and adds the sum of its own
 * process. Several processes can pass a limit by the traffic of one interval
 * between two writes, and the record accepts that.
 *
 * With no limit of the account and no cap of the installation, a check reads
 * no total and closes nothing. The limits of an account change rarely, so a
 * check keeps the account and its limits for `subjectTtlMs`, and a change of
 * a limit holds within that time. The totals are read at each check that
 * needs them. The account page reads the account again each time, so it
 * always shows the limits as they are stored.
 */
import {
  noTransferLimits,
  sumCounts,
  zeroCounts,
  type MonthlyCounts,
  type UsageCaps,
} from './model.ts';
import {
  checksNothing,
  openUsage,
  usageState,
  type UsageState,
} from './limits.ts';
import { nextMonthStart, usageMonth } from './month.ts';
import type {
  MonthlyUsageStore,
  UsageSubject,
  UsageSubjectKey,
} from './ports.ts';
import { createUsageTally } from './tally.ts';

/** What one meter needs. */
export type UsageMeterOptions = {
  readonly store: MonthlyUsageStore;
  readonly caps: UsageCaps;
  readonly clock: () => Date;
  /** How long a check keeps an account and its limits, in milliseconds. */
  readonly subjectTtlMs: number;
};

/** What the account page shows of the current month. */
export type AccountMonthView = {
  /** The month, as `YYYY-MM`. */
  readonly month: string;
  /** The first instant of the next month, as ISO 8601. */
  readonly endsAt: string;
  /** The counts of the account, stored and of this process. */
  readonly counts: MonthlyCounts;
  readonly state: UsageState;
};

/** The state of the reader path of one workspace. */
export type PublishedUsage = {
  /** The owner whom the bytes of the answer count for, or `null`. */
  readonly accountId: string | null;
  readonly state: UsageState;
};

/** The kind of one call to an object store (record 0192). */
export type ObjectCall = 'write' | 'read';

export type UsageMeter = {
  /** Counts bytes of the reader path, for the owner or for no account. */
  countPublished(accountId: string | null, bytes: number): void;
  /** Counts bytes of an authenticated answer, for the account. */
  countDownload(accountId: string, bytes: number): void;
  /** Counts one call to the object store, for the installation. */
  countObjectCall(kind: ObjectCall): void;
  /** What the limits close for an account now. */
  accountState(accountId: string): Promise<UsageState>;
  /** What the caps of the installation close now. */
  installationState(): Promise<UsageState>;
  /** The owner of a workspace and what the limits close on its reader path. */
  publishedState(workspaceId: string): Promise<PublishedUsage>;
  /** The month of an account for its own page, read in full. */
  accountMonth(accountId: string): Promise<AccountMonthView>;
  /**
   * Writes the sums of this process. A failed write keeps them for the next
   * write and rejects. Two calls never write at once.
   */
  flush(): Promise<void>;
};

/** The most accounts that a meter keeps in memory between two checks. */
export const maxKeptSubjects = 10_000;

/** One count of bytes as four counts. */
function bytesOf(kind: 'published' | 'download', bytes: number): MonthlyCounts {
  return kind === 'published'
    ? { ...zeroCounts, publishedTransferBytes: bytes }
    : { ...zeroCounts, downloadBytes: bytes };
}

/** Whether a number of bytes is one that a count takes. */
function countable(bytes: number): boolean {
  return Number.isSafeInteger(bytes) && bytes > 0;
}

/** Makes the meter of one process. */
export function createUsageMeter(options: UsageMeterOptions): UsageMeter {
  const { store, caps, clock } = options;
  const tally = createUsageTally();
  const kept = new Map<
    string,
    { readonly at: number; readonly subject: UsageSubject | null }
  >();
  let writing: Promise<void> = Promise.resolve();

  const subjectOf = async (
    key: UsageSubjectKey,
  ): Promise<UsageSubject | null> => {
    const name =
      'accountId' in key ? `a:${key.accountId}` : `w:${key.workspaceId}`;
    const now = clock().getTime();
    const found = kept.get(name);
    if (found !== undefined && now - found.at < options.subjectTtlMs)
      return found.subject;
    const subject = await store.usageSubject(key);
    if (options.subjectTtlMs > 0) {
      if (kept.size >= maxKeptSubjects) kept.clear();
      kept.set(name, { at: now, subject });
    }
    return subject;
  };

  /** The totals of the month with the sums of this process. */
  const totals = async (
    month: string,
    accountId: string | null,
  ): Promise<{ account: MonthlyCounts; installation: MonthlyCounts }> => {
    const stored = await store.storedUsage(month, accountId);
    return {
      account:
        accountId === null
          ? zeroCounts
          : sumCounts(stored.account, tally.pending(month, accountId)),
      installation: sumCounts(stored.installation, tally.pending(month, null)),
    };
  };

  /** What the limits of one subject close, reading totals only if needed. */
  const stateOf = async (subject: UsageSubject | null): Promise<UsageState> => {
    const limits = subject?.limits ?? noTransferLimits;
    if (checksNothing(limits, caps)) return openUsage;
    const counted = await totals(
      usageMonth(clock()),
      subject?.accountId ?? null,
    );
    return usageState({ limits, caps, ...counted });
  };

  const write = async (): Promise<void> => {
    const entries = tally.take();
    if (entries.length === 0) return;
    try {
      await store.addUsage(entries);
    } catch (error) {
      tally.settle(entries, false);
      throw error;
    }
    tally.settle(entries, true);
  };

  return {
    countPublished(accountId, bytes) {
      if (countable(bytes))
        tally.add(usageMonth(clock()), accountId, bytesOf('published', bytes));
    },

    countDownload(accountId, bytes) {
      if (countable(bytes))
        tally.add(usageMonth(clock()), accountId, bytesOf('download', bytes));
    },

    countObjectCall(kind) {
      tally.add(usageMonth(clock()), null, {
        ...zeroCounts,
        ...(kind === 'write' ? { objectWrites: 1 } : { objectReads: 1 }),
      });
    },

    async accountState(accountId) {
      return stateOf(await subjectOf({ accountId }));
    },

    installationState() {
      return stateOf(null);
    },

    async publishedState(workspaceId) {
      const subject = await subjectOf({ workspaceId });
      return {
        accountId: subject?.accountId ?? null,
        state: await stateOf(subject),
      };
    },

    async accountMonth(accountId) {
      const now = clock();
      const month = usageMonth(now);
      const subject = await store.usageSubject({ accountId });
      const counted = await totals(month, accountId);
      return {
        month,
        endsAt: nextMonthStart(now).toISOString(),
        counts: counted.account,
        state: usageState({
          limits: subject?.limits ?? noTransferLimits,
          caps,
          ...counted,
        }),
      };
    },

    flush() {
      const next = writing.then(write);
      writing = next.catch(() => undefined);
      return next;
    },
  };
}
