/**
 * The single sync worker lease.
 *
 * One browser profile may hold several tabs of one workspace, but only one
 * tab submits the queue at a time. The lease names the active worker and its
 * expiry; a worker renews it every cycle, and a worker whose lease expired
 * without renewal has failed, so another tab may take over. The server
 * mutation receipts stay the final protection against a double submit.
 *
 * The lease is one row for the browser profile and not one row per workspace.
 * Record 0050 runs an engine for the open workspace and for every workspace
 * that still holds queued work, so one tab can run several engines at once.
 * Every engine of one tab is given that tab's owner identifier, and the
 * compare-and-set below refuses only a different owner, so those engines renew
 * one lease between them and a second tab is still excluded. The unit of
 * exclusion is therefore the tab, not the workspace. An engine that was given
 * an owner identifier of its own would lock its siblings out.
 *
 * The store owns the compare-and-set; this module owns the expiry math so it
 * stays testable with a fake clock.
 */
import type { LocalStore } from './local-port.ts';

/**
 * The part of the local store that the lease needs.
 *
 * Each call below names only the port members it uses, so a caller supplies
 * one row of state and nothing else. A `LocalStore` satisfies every one of
 * these, and a test needs no wider double and no type assertion (record 0019).
 */
export type LeaseStore = Pick<
  LocalStore,
  'acquireLease' | 'releaseLease' | 'readLeaseState'
>;

/** How one worker names itself and how long its lease lasts. */
export type WorkerLease = {
  readonly ownerId: string;
  /** How long one acquired lease lasts, in milliseconds. */
  readonly ttlMs: number;
  /** Milliseconds since the Unix epoch. Defaults to the system clock. */
  readonly clock?: () => number;
};

/**
 * Takes or renews the sync worker lease.
 *
 * Returns `true` when this worker now holds the lease: no lease existed, the
 * stored one expired, or this owner already held it. Returns `false` when
 * another worker holds a live lease.
 */
export async function acquireWorkerLease(
  local: Pick<LeaseStore, 'acquireLease'>,
  lease: WorkerLease,
): Promise<boolean> {
  const now = lease.clock === undefined ? Date.now() : lease.clock();
  return local.acquireLease(lease.ownerId, now + lease.ttlMs);
}

/**
 * Gives up the sync worker lease.
 *
 * Only the holding owner releases it. A worker that lost its lease to a
 * takeover releases nothing.
 */
export async function releaseWorkerLease(
  local: Pick<LeaseStore, 'releaseLease'>,
  ownerId: string,
): Promise<void> {
  await local.releaseLease(ownerId);
}

/**
 * Whether a lease expiry lies in the past.
 *
 * A worker whose lease expired without renewal has failed, so another tab
 * may take over. The comparison is strict: a lease that expires exactly now
 * is already gone.
 */
export function isLeaseExpired(expiresAt: number, now: number): boolean {
  return expiresAt <= now;
}

/**
 * Reads the current sync worker lease without changing it.
 *
 * An update flow uses this to decide whether queue writes must stop before
 * a schema migration: a live lease owned by another tab blocks the upgrade
 * and the old application stays usable with its drafts intact.
 */
export async function readWorkerLease(
  local: Pick<LeaseStore, 'readLeaseState'>,
): Promise<{ readonly ownerId: string; readonly expiresAt: number } | null> {
  return local.readLeaseState();
}
