/**
 * Composition-bound sync retention cleanup job.
 *
 * Removes expired snapshots with their items and change records older than 90
 * days. Revisions, contents, receipts, and purge markers are left alone, so
 * saved history stays valid beyond the event window.
 */
import type { WorkspaceStoreHandle } from '@notesapp/storage-server';

export function createSyncCleanup(
  store: Pick<WorkspaceStoreHandle, 'cleanupSync'>,
): (now?: Date) => Promise<{
  expiredSnapshots: number;
  oldChanges: number;
}> {
  return async (now = new Date()) => store.cleanupSync(now);
}
