/**
 * The preferences area of the local store.
 *
 * It stores the small settings that survive a reload: attachment pins,
 * history pins, and the account-wide sign-out marker that reconnect reads
 * first. It also holds the single sync worker lease, the one row that
 * coordinates every tab of one browser profile.
 */
import { accountWide, type LocalStore } from '@notesapp/sync';
import { guard } from '../database.ts';
import { validateLease } from '../migrations.ts';
import { signOutMarkerName, type LocalStoreContext } from './shared.ts';

type PreferencesSlice = Pick<
  LocalStore,
  | 'setAttachmentPinned'
  | 'isAttachmentPinned'
  | 'setHistoryPinned'
  | 'isHistoryPinned'
  | 'setSignOutMarker'
  | 'hasSignOutMarker'
  | 'clearSignOutMarker'
  | 'acquireLease'
  | 'releaseLease'
  | 'readLeaseState'
>;

export function createPreferencesSlice(
  ctx: LocalStoreContext,
): PreferencesSlice {
  const { serverOrigin, db, tables, clock } = ctx;

  /** The key of the single sync worker lease row. */
  const leaseKey = 'worker';

  return {
    setAttachmentPinned(
      accountId: string,
      workspaceId: string,
      digest: string,
      pinned: boolean,
    ): Promise<void> {
      return guard('pinning an attachment', () =>
        db.transaction('rw', tables.preferences, async () => {
          const name = `pin-attachment:${digest}`;
          const key: [string, string, string, string] = [
            serverOrigin,
            accountId,
            workspaceId,
            name,
          ];
          if (pinned)
            await tables.preferences.put({
              serverOrigin,
              accountId,
              workspaceId,
              name,
              value: '1',
            });
          else await tables.preferences.delete(key);
        }),
      );
    },

    isAttachmentPinned(
      accountId: string,
      workspaceId: string,
      digest: string,
    ): Promise<boolean> {
      return guard('reading an attachment pin', () =>
        db.transaction('r', tables.preferences, async () => {
          const stored: unknown = await tables.preferences.get([
            serverOrigin,
            accountId,
            workspaceId,
            `pin-attachment:${digest}`,
          ]);
          return stored !== undefined;
        }),
      );
    },

    setHistoryPinned(
      accountId: string,
      workspaceId: string,
      revisionId: string,
      pinned: boolean,
    ): Promise<void> {
      return guard('pinning a historic revision', () =>
        db.transaction('rw', tables.preferences, async () => {
          const name = `pin-history:${revisionId}`;
          const key: [string, string, string, string] = [
            serverOrigin,
            accountId,
            workspaceId,
            name,
          ];
          if (pinned)
            await tables.preferences.put({
              serverOrigin,
              accountId,
              workspaceId,
              name,
              value: '1',
            });
          else await tables.preferences.delete(key);
        }),
      );
    },

    isHistoryPinned(
      accountId: string,
      workspaceId: string,
      revisionId: string,
    ): Promise<boolean> {
      return guard('reading a history pin', () =>
        db.transaction('r', tables.preferences, async () => {
          const stored: unknown = await tables.preferences.get([
            serverOrigin,
            accountId,
            workspaceId,
            `pin-history:${revisionId}`,
          ]);
          return stored !== undefined;
        }),
      );
    },

    setSignOutMarker(accountId: string): Promise<void> {
      return guard('recording the sign-out marker', () =>
        db.transaction('rw', tables.preferences, async () => {
          await tables.preferences.put({
            serverOrigin,
            accountId,
            workspaceId: accountWide,
            name: signOutMarkerName,
            value: 'signed-out',
          });
        }),
      );
    },

    hasSignOutMarker(accountId: string): Promise<boolean> {
      return guard('reading the sign-out marker', () =>
        db.transaction('r', tables.preferences, async () => {
          const stored: unknown = await tables.preferences.get([
            serverOrigin,
            accountId,
            accountWide,
            signOutMarkerName,
          ]);
          return stored !== undefined;
        }),
      );
    },

    clearSignOutMarker(accountId: string): Promise<void> {
      return guard('clearing the sign-out marker', () =>
        db.transaction('rw', tables.preferences, async () => {
          await tables.preferences.delete([
            serverOrigin,
            accountId,
            accountWide,
            signOutMarkerName,
          ]);
        }),
      );
    },

    acquireLease(ownerId: string, expiresAt: number): Promise<boolean> {
      return guard('acquiring the sync lease', () =>
        db.transaction('rw', tables.leases, async () => {
          const stored: unknown = await tables.leases.get(leaseKey);
          if (stored !== undefined) {
            const lease = validateLease(stored);
            // Another worker holds a live lease. An expired lease, or one
            // this owner already holds, may be taken over or renewed.
            if (lease.ownerId !== ownerId && lease.expiresAt > clock())
              return false;
          }
          await tables.leases.put({
            key: leaseKey,
            ownerId,
            expiresAt,
          });
          return true;
        }),
      );
    },

    releaseLease(ownerId: string): Promise<void> {
      return guard('releasing the sync lease', () =>
        db.transaction('rw', tables.leases, async () => {
          const stored: unknown = await tables.leases.get(leaseKey);
          if (stored === undefined) return;
          // Releasing a lease that another worker took over does nothing.
          if (validateLease(stored).ownerId !== ownerId) return;
          await tables.leases.delete(leaseKey);
        }),
      );
    },

    readLeaseState(): Promise<{
      readonly ownerId: string;
      readonly expiresAt: number;
    } | null> {
      return guard('reading the sync lease', () =>
        db.transaction('r', tables.leases, async () => {
          const stored: unknown = await tables.leases.get(leaseKey);
          if (stored === undefined) return null;
          const lease = validateLease(stored);
          return { ownerId: lease.ownerId, expiresAt: lease.expiresAt };
        }),
      );
    },
  };
}
