/**
 * Composition-bound retention run of published links.
 *
 * It takes away the record of a link that stopped and the record of a reading
 * ticket that expired. It does not take access away: decision 0030 makes a
 * revoked link and an expired link stop at the next request, because the
 * resolve rule reads the record on every call. This run only removes the dead
 * row.
 *
 * The hourly `runCleanup` of `app.ts` calls it beside the sync run and the
 * attachment run, so this deployment gains no second scheduler and no timer of
 * its own, which is the acceptance of plan 007 item 29.
 *
 * The cutoff is the instant of the run. A record that stopped one moment ago
 * is already dead, so nothing waits: `packages/storage-server` deletes by the
 * two partial indexes of the link table and the expiry index of the ticket
 * table, and a live link is never read.
 */
import type {
  PublicationCleanupResult,
  WorkspaceStoreHandle,
} from '@notesapp/storage-server';

export function createPublicationCleanup(
  store: Pick<WorkspaceStoreHandle, 'cleanupPublications'>,
): (now?: Date) => Promise<PublicationCleanupResult> {
  return async (now = new Date()) => store.cleanupPublications(now);
}
