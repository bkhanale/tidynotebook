/**
 * Composition-bound attachment cleanup job.
 *
 * Reclaims temporary and unreferenced finalized objects older than 24 hours.
 */
import type { AttachmentStore } from '@notesapp/storage-server';

export function createAttachmentCleanup(
  store: AttachmentStore,
): (now?: Date) => Promise<number> {
  return (now = new Date()) => store.reclaimAttachments(now);
}
