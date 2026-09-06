/**
 * Access recovery of one account.
 *
 * When the session expires, sync pauses and drafts are kept until sign-in.
 * When read access is revoked, server reads and writes stop and kept work
 * waits in the account-bound recovery area. When the role changes to viewer,
 * writes stop while permitted reads continue and pending edits wait in the
 * same area. The panel shows recovery content only to the original account:
 * the store partitions records by origin, account, and workspace, and this
 * component additionally refuses a record whose account differs from the
 * signed-in one.
 *
 * Online sign-out settles pending work or takes an explicit discard, then
 * revokes the session through the generated client and clears private data.
 * Offline sign-out needs an explicit discard, clears private data, and
 * records a sign-out marker. On reconnect the marker runs revocation before
 * any account content is restored.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import type { RecoveryRecord } from '@notesapp/sync';
import { Button, StatusRegion } from '@notesapp/ui';
import {
  accessStateMessage,
  completePendingSignOut,
  isRecoveryVisible as isRecordVisible,
  revokeSessionViaClient,
  signOut,
  type AccessState,
} from '../pwa/lifecycle.ts';
import { problemMessage, useLocalStore, useSession } from '../app.tsx';

export { isRecordVisible };

/** One clipboard copy of a recovery text. */
export type CopyRecoveryText = (text: string) => Promise<boolean>;

/**
 * The access and recovery panel of one account and workspace.
 *
 * Clipboard and removal actions work per record. Sign-out actions call the
 * callbacks the composition wires to the lifecycle module and the generated
 * client; this component performs no network traffic itself.
 */
export function RecoveryPanel({
  accountId,
  access,
  records,
  pendingCount,
  online,
  hasSignOutMarker,
  onCopy,
  onRemove,
  onSignOut,
  onCompleteSignOut,
}: {
  /** The signed-in account that must own every shown record. */
  readonly accountId: string;
  /** Where sync stands for this workspace. */
  readonly access: AccessState;
  /** Recovery records already read for this account and workspace. */
  readonly records: readonly RecoveryRecord[];
  /** Queued mutations that wait on this device. */
  readonly pendingCount: number;
  /** Whether the device currently reaches the server. */
  readonly online: boolean;
  /** Whether an offline sign-out marker waits for revocation. */
  readonly hasSignOutMarker: boolean;
  readonly onCopy: CopyRecoveryText;
  readonly onRemove: (recoveryId: string) => void;
  readonly onSignOut: (online: boolean, discardPending: boolean) => void;
  readonly onCompleteSignOut: () => void;
}): ReactNode {
  const [discard, setDiscard] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const visible = records.filter((record) =>
    isRecordVisible(record, accountId),
  );

  return (
    <section aria-labelledby="recovery-heading">
      <h2 id="recovery-heading">Access and recovery</h2>
      <StatusRegion message={accessStateMessage(access)} />
      {pendingCount > 0 ? (
        <p>
          {pendingCount} change(s) wait on this device.
          {discard
            ? ' Sign-out discards them.'
            : ' Settle them online or discard them explicitly before sign-out.'}
        </p>
      ) : (
        <p>No change waits on this device.</p>
      )}
      <p>
        <label htmlFor="recovery-discard">
          <input
            id="recovery-discard"
            type="checkbox"
            checked={discard}
            onChange={(event): void => {
              setDiscard(event.target.checked);
            }}
          />{' '}
          Discard pending changes on sign-out
        </label>
      </p>
      <p>
        <Button
          variant="secondary"
          label={
            online
              ? 'Sign out with server revocation'
              : 'Sign out offline with explicit discard'
          }
          onClick={() => {
            onSignOut(online, discard);
          }}
        >
          {online ? 'Sign out' : 'Sign out offline'}
        </Button>{' '}
        {hasSignOutMarker ? (
          <Button
            variant="secondary"
            label="Revoke the pending offline session now"
            onClick={() => {
              onCompleteSignOut();
            }}
          >
            Complete pending sign-out
          </Button>
        ) : null}
      </p>
      {hasSignOutMarker ? (
        <p role="note">
          An offline sign-out waits for revocation. Reconnect runs revocation
          before any account content is restored.
        </p>
      ) : null}
      <h3>Kept work</h3>
      {visible.length === 0 ? (
        <p>No kept work for this account in this workspace.</p>
      ) : (
        <ul>
          {visible.map((record) => (
            <li key={record.recoveryId}>
              <p>
                {record.path} ({record.reason})
              </p>
              <Button
                variant="secondary"
                label={`Copy kept text of ${record.path}`}
                onClick={() => {
                  void onCopy(record.text).then((ok) => {
                    if (ok) setCopiedId(record.recoveryId);
                  });
                }}
              >
                {copiedId === record.recoveryId ? 'Copied' : 'Copy'}
              </Button>{' '}
              <Button
                variant="secondary"
                label={`Remove kept copy of ${record.path}`}
                onClick={() => {
                  onRemove(record.recoveryId);
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The routed recovery screen of one workspace.
 *
 * Loads the account-bound recovery area, the pending queue depth, and the
 * offline sign-out marker. Sign-out and revocation run through the lifecycle
 * module with the generated client; clipboard uses the platform clipboard.
 */
export function RecoveryRoute(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const session = useSession();
  const { store } = useLocalStore();
  const accountId = session.account?.accountId ?? null;
  const [records, setRecords] = useState<readonly RecoveryRecord[]>([]);
  const [pending, setPending] = useState(0);
  const [marker, setMarker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (store === null || accountId === null || workspaceId === null) return;
    try {
      const [kept, queue, marked] = await Promise.all([
        store.recover(accountId, workspaceId),
        store.pending(accountId, workspaceId),
        store.hasSignOutMarker(accountId),
      ]);
      setRecords(kept);
      setPending(queue.length);
      setMarker(marked);
      setError(null);
    } catch (failure: unknown) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Recovery status is unavailable.',
      );
    }
  }, [store, accountId, workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (workspaceId === null || accountId === null || store === null)
    return (
      <main>
        <StatusRegion message="Loading recovery." />
      </main>
    );

  const activeStore = store;
  const activeAccount = accountId;
  const activeWorkspace = workspaceId;

  return (
    <main>
      {error !== null ? (
        <p className="notes-status-error" role="alert">
          {error}
        </p>
      ) : null}
      <RecoveryPanel
        accountId={activeAccount}
        access={marker ? 'session-expired' : 'ok'}
        records={records}
        pendingCount={pending}
        online={typeof navigator === 'undefined' ? true : navigator.onLine}
        hasSignOutMarker={marker}
        onCopy={(text) =>
          navigator.clipboard
            .writeText(text)
            .then(() => true)
            .catch(() => false)
        }
        onRemove={(recoveryId) => {
          void activeStore
            .removeRecovery(activeAccount, activeWorkspace, recoveryId)
            .then(() => reload())
            .catch((failure: unknown) => {
              setError(problemMessage(failure));
            });
        }}
        onSignOut={(online, discardPending) => {
          void signOut(
            activeStore,
            activeAccount,
            [activeWorkspace],
            online,
            discardPending,
            revokeSessionViaClient,
          )
            .then(() => reload())
            .catch((failure: unknown) => {
              setError(problemMessage(failure));
            });
        }}
        onCompleteSignOut={() => {
          void completePendingSignOut(
            activeStore,
            activeAccount,
            revokeSessionViaClient,
          )
            .then(() => reload())
            .catch((failure: unknown) => {
              setError(problemMessage(failure));
            });
        }}
      />
    </main>
  );
}
