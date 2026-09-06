/**
 * Offline readiness of one workspace.
 *
 * Readiness needs stored Markdown and stored application assets. Attachment
 * completeness is reported separately and never blocks editing: images load
 * on use, and an explicit Make available offline action pins them. History
 * pins work the same way for older revisions. Downloads run through the
 * generated client, never through a handwritten transport, and never through
 * Background Sync.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Button, StatusRegion } from '@notesapp/ui';
import {
  downloadProgress,
  isReadyOffline,
  type DownloadProgress,
  type OfflineReadiness,
} from '../pwa/lifecycle.ts';
import { useLocalStore, useSession } from '../app.tsx';

/** What `toOfflineReadiness` decides from. */
export type ReadinessInput = {
  /** Stored Markdown bodies of the active workspace. */
  readonly markdownDownloaded: number;
  /** Required Markdown bodies of the active workspace snapshot. */
  readonly markdownTotal: number;
  /** The shell, editor, fonts, math, and diagram modules are cached. */
  readonly appAssetsReady: boolean;
  /** Stored attachment bytes chosen for offline use. */
  readonly attachmentsDownloaded: number;
  /** Referenced attachment bytes chosen for offline use. */
  readonly attachmentsTotal: number;
};

/**
 * Builds offline readiness from download positions.
 *
 * An empty workspace with no required Markdown is complete. An empty pin
 * set with no chosen attachments is complete as well.
 */
export function toOfflineReadiness(input: ReadinessInput): OfflineReadiness {
  return {
    markdownComplete: downloadProgress(
      input.markdownDownloaded,
      input.markdownTotal,
    ).complete,
    appAssetsComplete: input.appAssetsReady,
    attachmentsComplete: downloadProgress(
      input.attachmentsDownloaded,
      input.attachmentsTotal,
    ).complete,
  };
}

/** One readable sentence for an offline readiness state. */
export function readinessMessage(state: OfflineReadiness): string {
  if (isReadyOffline(state)) {
    if (!state.attachmentsComplete)
      return 'Ready for offline editing. Some pinned attachments are still downloading.';
    return 'Ready for offline editing.';
  }
  const missing: string[] = [];
  if (!state.markdownComplete) missing.push('workspace notes');
  if (!state.appAssetsComplete) missing.push('application assets');
  return `Offline provisioning downloads ${missing.join(' and ')}. Editing stays available; new files wait for the download.`;
}

/**
 * The offline status panel of one workspace.
 *
 * Shows readiness, Markdown and attachment progress with completeness, and
 * the image and history pin actions. Pin callbacks copy bytes through the
 * generated client into the local store; this component performs no network
 * traffic itself.
 */
export function OfflineStatusPanel({
  readiness,
  markdown,
  attachments,
  pinnedImages,
  pinnedHistory,
  onPinImages,
  onPinHistory,
}: {
  readonly readiness: OfflineReadiness;
  readonly markdown: DownloadProgress;
  readonly attachments: DownloadProgress;
  readonly pinnedImages?: number | undefined;
  readonly pinnedHistory?: number | undefined;
  readonly onPinImages?: (() => void) | undefined;
  readonly onPinHistory?: (() => void) | undefined;
}): ReactNode {
  const [pinning, setPinning] = useState<'images' | 'history' | null>(null);

  return (
    <section aria-labelledby="offline-status-heading">
      <h2 id="offline-status-heading">Offline status</h2>
      <StatusRegion message={readinessMessage(readiness)} />
      <p>
        <label htmlFor="offline-markdown-progress">Workspace notes</label>
        <progress
          id="offline-markdown-progress"
          value={markdown.downloaded}
          max={Math.max(markdown.total, 1)}
        />
        <span>
          {' '}
          {markdown.downloaded} of {markdown.total} ({markdown.percent}%)
        </span>
      </p>
      <p>
        <label htmlFor="offline-attachments-progress">Pinned attachments</label>
        <progress
          id="offline-attachments-progress"
          value={attachments.downloaded}
          max={Math.max(attachments.total, 1)}
        />
        <span>
          {' '}
          {attachments.downloaded} of {attachments.total} ({attachments.percent}
          %)
        </span>
      </p>
      {pinnedImages !== undefined ? (
        <p>{pinnedImages} image(s) pinned for offline use.</p>
      ) : null}
      {pinnedHistory !== undefined ? (
        <p>{pinnedHistory} historic revision(s) pinned for offline use.</p>
      ) : null}
      {onPinImages !== undefined ? (
        <Button
          variant="secondary"
          label="Make referenced images available offline"
          onClick={() => {
            setPinning('images');
            onPinImages();
            setPinning(null);
          }}
        >
          {pinning === 'images'
            ? 'Pinning images.'
            : 'Make images available offline'}
        </Button>
      ) : null}
      {onPinHistory !== undefined ? (
        <Button
          variant="secondary"
          label="Pin history for offline use"
          onClick={() => {
            setPinning('history');
            onPinHistory();
            setPinning(null);
          }}
        >
          {pinning === 'history'
            ? 'Pinning history.'
            : 'Pin history for offline use'}
        </Button>
      ) : null}
    </section>
  );
}

export type { DownloadProgress, OfflineReadiness };
export { downloadProgress, isReadyOffline };

/**
 * The routed offline status of one workspace.
 *
 * Reads accepted Markdown metadata and stored bodies from the local store,
 * checks the installed worker for cached application assets, and wires the
 * image and history pin actions to the store. Attachment bytes themselves
 * load on use through the generated binary operation; pins only mark them.
 */
export function OfflineStatusRoute(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const session = useSession();
  const { store } = useLocalStore();
  const accountId = session.account?.accountId ?? null;
  const [readiness, setReadiness] = useState<OfflineReadiness>({
    markdownComplete: false,
    appAssetsComplete: false,
    attachmentsComplete: true,
  });
  const [markdown, setMarkdown] = useState<DownloadProgress>({
    downloaded: 0,
    total: 0,
    percent: 100,
    complete: false,
  });
  const [attachments, setAttachments] = useState<DownloadProgress>({
    downloaded: 0,
    total: 0,
    percent: 100,
    complete: true,
  });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (store === null || accountId === null || workspaceId === null) return;
    try {
      const files = await store.listAcceptedFiles(accountId, workspaceId);
      const notes = files.filter(
        (file) => file.kind === 'note' && !file.deleted,
      );
      let stored = 0;
      for (const file of notes) {
        if (file.acceptedHeadDigest === null) continue;
        if (
          await store.hasContent(
            accountId,
            workspaceId,
            file.acceptedHeadDigest,
          )
        )
          stored += 1;
      }
      const linked = files.filter(
        (file) => file.kind === 'attachment' && !file.deleted,
      );
      let pinnedStored = 0;
      for (const file of linked) {
        if (file.acceptedHeadDigest === null) continue;
        if (
          (await store.isAttachmentPinned(
            accountId,
            workspaceId,
            file.acceptedHeadDigest,
          )) &&
          (await store.hasContent(
            accountId,
            workspaceId,
            file.acceptedHeadDigest,
          ))
        )
          pinnedStored += 1;
      }
      let assetsReady = false;
      try {
        if (typeof caches !== 'undefined') {
          const hit = await caches.match('/index.html');
          assetsReady = hit !== undefined;
        }
      } catch {
        assetsReady = false;
      }
      setMarkdown(downloadProgress(stored, notes.length));
      setAttachments(downloadProgress(pinnedStored, linked.length));
      setReadiness({
        markdownComplete: downloadProgress(stored, notes.length).complete,
        appAssetsComplete: assetsReady,
        attachmentsComplete: downloadProgress(pinnedStored, linked.length)
          .complete,
      });
      setError(null);
    } catch {
      setError('Offline status is unavailable.');
    }
  }, [store, accountId, workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (workspaceId === null || accountId === null || store === null)
    return (
      <main>
        <StatusRegion message="Loading offline status." />
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
      <OfflineStatusPanel
        readiness={readiness}
        markdown={markdown}
        attachments={attachments}
        onPinImages={() => {
          void (async (): Promise<void> => {
            const files = await activeStore.listAcceptedFiles(
              activeAccount,
              activeWorkspace,
            );
            for (const file of files) {
              if (
                file.kind !== 'attachment' ||
                file.acceptedHeadDigest === null
              )
                continue;
              await activeStore.setAttachmentPinned(
                activeAccount,
                activeWorkspace,
                file.acceptedHeadDigest,
                true,
              );
            }
            await reload();
          })();
        }}
        onPinHistory={() => {
          void (async (): Promise<void> => {
            const checkpoints = await activeStore.listAcceptedFiles(
              activeAccount,
              activeWorkspace,
            );
            for (const file of checkpoints) {
              if (file.acceptedHeadRevisionId === null) continue;
              await activeStore.setHistoryPinned(
                activeAccount,
                activeWorkspace,
                file.acceptedHeadRevisionId,
                true,
              );
            }
            await reload();
          })();
        }}
      />
    </main>
  );
}
