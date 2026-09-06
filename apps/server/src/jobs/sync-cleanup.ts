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
  writePause?: {
    beginWrite: () => (() => void) | null;
  },
): (now?: Date) => Promise<{
  expiredSnapshots: number;
  oldChanges: number;
}> {
  return async (now = new Date()) => {
    const release = writePause?.beginWrite();
    if (writePause !== undefined && release === null) {
      return { expiredSnapshots: 0, oldChanges: 0 };
    }
    try {
      return await store.cleanupSync(now);
    } finally {
      release?.();
    }
  };
}
