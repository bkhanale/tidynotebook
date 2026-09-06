/**
 * The single sync worker lease.
 *
 * One browser profile may hold several tabs of one workspace, but only one
 * tab submits the queue at a time. The lease names the active worker and its
 * expiry; a worker renews it every cycle, and a worker whose lease expired
 * without renewal has failed, so another tab may take over. The server
 * mutation receipts stay the final protection against a double submit.
 *
 * The store owns the compare-and-set; this module owns the expiry math so it
 * stays testable with a fake clock.
 */
import type { LocalStore } from './local-port.ts';

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
  local: LocalStore,
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
  local: LocalStore,
  ownerId: string,
): Promise<void> {
  await local.releaseLease(ownerId);
}
