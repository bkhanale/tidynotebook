/**
 * Composition-bound attachment cleanup job.
 *
 * Reclaims temporary and unreferenced finalized objects older than 24 hours.
 */
import type { AttachmentStore } from '@notesapp/storage-server';

export function createAttachmentCleanup(
  store: AttachmentStore,
  writePause?: {
    beginWrite: () => (() => void) | null;
  },
): (now?: Date) => Promise<number> {
  return async (now = new Date()) => {
    const release = writePause?.beginWrite();
    if (writePause !== undefined && release === null) {
      return 0;
    }
    try {
      return await store.reclaimAttachments(now);
    } finally {
      release?.();
    }
  };
}
