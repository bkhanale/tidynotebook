/**
 * The workspaces that the open tabs of one account read (record 0130).
 *
 * Only the lease tab sends and reads, so it serves the open workspace of
 * every tab of the account. Each tab states its open workspace with a
 * heartbeat, and an interest that no heartbeat renews expires, so a tab that
 * closed or froze cannot keep a subscription forever. A missed heartbeat is
 * only a missed hint: the tab states its interest again on its next beat.
 */

/** How often a tab states its interest, in milliseconds. */
export const interestHeartbeatMs = 10_000;

/** How long one statement lasts. Three beats can be missed before it ends. */
export const interestTtlMs = 3 * interestHeartbeatMs;

/** One statement of one tab. `null` means that the tab reads no workspace. */
export type TabInterest = {
  readonly tabId: string;
  readonly workspaceId: string | null;
};

/** The live interests that the lease tab collects. */
export type InterestTable = {
  /** Records a statement, and answers whether the live set changed. */
  readonly note: (interest: TabInterest, now: number) => boolean;
  /** Forgets a tab that said goodbye, and answers whether the set changed. */
  readonly forget: (tabId: string, now: number) => boolean;
  /** Drops what expired, and answers whether the set changed. */
  readonly expire: (now: number) => boolean;
  /** The workspaces of the live interests, sorted and each once. */
  readonly live: (now: number) => readonly string[];
};

/** Builds an empty table. */
export function createInterestTable(): InterestTable {
  const entries = new Map<
    string,
    { readonly workspaceId: string | null; readonly expiresAt: number }
  >();
  const live = (now: number): readonly string[] =>
    [
      ...new Set(
        [...entries.values()]
          .filter((entry) => entry.expiresAt > now)
          .flatMap((entry) =>
            entry.workspaceId === null ? [] : [entry.workspaceId],
          ),
      ),
    ].sort();
  const changed = (before: readonly string[], now: number): boolean =>
    before.join(' ') !== live(now).join(' ');
  return {
    note: (interest, now) => {
      const before = live(now);
      entries.set(interest.tabId, {
        workspaceId: interest.workspaceId,
        expiresAt: now + interestTtlMs,
      });
      return changed(before, now);
    },
    forget: (tabId, now) => {
      const before = live(now);
      entries.delete(tabId);
      return changed(before, now);
    },
    expire: (now) => {
      let dropped = false;
      for (const [tabId, entry] of entries)
        if (entry.expiresAt <= now) {
          entries.delete(tabId);
          dropped = entry.workspaceId !== null || dropped;
        }
      return dropped;
    },
    live,
  };
}

/**
 * The subscription set of the lease tab: its own open workspace, the live
 * interests of the other tabs, and every workspace with queued work, each
 * once and at most `limit` of them. The open workspaces come first, so a cut
 * keeps what a person reads.
 */
export function subscriptionSet(
  own: string | null,
  interests: readonly string[],
  queued: readonly string[],
  limit: number,
): readonly string[] {
  const ordered = [...(own === null ? [] : [own]), ...interests, ...queued];
  return [...new Set(ordered)].slice(0, limit);
}
