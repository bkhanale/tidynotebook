/** Explicit preview, publication update, and revocation controls. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  createShare,
  getFile,
  listShares,
  revokeShare,
  updateShare,
  type Share,
} from '@notesapp/api-client';
import { Button, StatusRegion } from '@notesapp/ui';
import { problemMessage, useLocalStore, useSession } from '../app.tsx';

/** Converts an optional local input value to an API timestamp. */
function expiry(value: string): string | null {
  return value === '' ? null : new Date(value).toISOString();
}

/** Controls public links for one accepted note. */
export function SharingPanel({
  workspaceId,
  fileId,
}: {
  readonly workspaceId: string;
  readonly fileId: string;
}): ReactNode {
  const localStore = useLocalStore();
  const session = useSession();
  const [head, setHead] = useState<{
    readonly revisionId: string;
    readonly text: string;
  } | null>(null);
  const [shares, setShares] = useState<readonly Share[]>([]);
  const [preview, setPreview] = useState('');
  const [expires, setExpires] = useState('');
  const [message, setMessage] = useState('');
  const [createdUrl, setCreatedUrl] = useState('');

  const reload = useCallback(async (): Promise<void> => {
    const [fileResult, sharesResult] = await Promise.all([
      getFile({ path: { workspaceId, fileId } }),
      listShares({ path: { workspaceId } }),
    ]);
    if (
      fileResult.data?.headRevisionId !== undefined &&
      fileResult.data.headRevisionId !== null
    ) {
      setHead({
        revisionId: fileResult.data.headRevisionId,
        text: fileResult.data.head?.text ?? '',
      });
    }
    if (sharesResult.data !== undefined)
      setShares(
        sharesResult.data.shares.filter((share) => share.fileId === fileId),
      );
  }, [fileId, workspaceId]);

  useEffect(() => {
    void reload().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Share load failed.'),
    );
    const accountId = session.account?.accountId;
    if (localStore.store === null || accountId === undefined) return;
    return localStore.store.subscribe((change) => {
      if (
        change.accountId === accountId &&
        change.workspaceId === workspaceId &&
        change.fileId === fileId &&
        change.kind === 'file'
      )
        void reload();
    });
  }, [
    fileId,
    localStore.store,
    reload,
    session.account?.accountId,
    workspaceId,
  ]);

  async function showPreview(): Promise<void> {
    if (head === null) return;
    const { renderMarkdown } = await import('@notesapp/markdown');
    setPreview(await renderMarkdown(head.text));
  }

  async function publish(): Promise<void> {
    if (head === null) return;
    const result = await createShare({
      path: { workspaceId },
      body: {
        fileId,
        pinnedRevisionId: head.revisionId,
        expiresAt: expiry(expires),
      },
    });
    if (result.data === undefined) {
      setMessage(problemMessage(result.error));
      return;
    }
    setCreatedUrl(result.data.url ?? '');
    setMessage('The accepted revision is public. Copy the URL now.');
    await reload();
  }

  async function update(item: Share): Promise<void> {
    if (head === null) return;
    const result = await updateShare({
      path: { workspaceId, shareId: item.shareId },
      body: {
        fileId,
        pinnedRevisionId: head.revisionId,
        expiresAt: expiry(expires),
      },
    });
    setMessage(
      result.data === undefined
        ? problemMessage(result.error)
        : 'The public link now shows the selected accepted revision.',
    );
    await reload();
  }

  async function revoke(item: Share): Promise<void> {
    const result = await revokeShare({
      path: { workspaceId, shareId: item.shareId },
    });
    setMessage(
      result.data === undefined
        ? problemMessage(result.error)
        : 'The public link is revoked.',
    );
    await reload();
  }

  return (
    <details className="notes-sharing">
      <summary>Public sharing</summary>
      <p>
        Publication pins an accepted revision. Saving later changes does not
        update a public link.
      </p>
      <label className="notes-label" htmlFor="share-expiry">
        Optional expiry
      </label>
      <input
        id="share-expiry"
        className="notes-input"
        type="datetime-local"
        value={expires}
        onChange={(event) => setExpires(event.target.value)}
      />
      <div className="notes-share-actions">
        <Button variant="secondary" onClick={() => void showPreview()}>
          Preview accepted revision
        </Button>
        <Button onClick={() => void publish()} disabled={head === null}>
          Publish new link
        </Button>
      </div>
      {message === '' ? null : <StatusRegion message={message} />}
      {createdUrl === '' ? null : (
        <p>
          <a href={createdUrl} target="_blank" rel="noreferrer">
            {createdUrl}
          </a>
        </p>
      )}
      {preview === '' ? null : (
        <article
          className="notes-share-preview"
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      )}
      <ul>
        {shares.map((item) => (
          <li key={item.shareId}>
            <span>
              Revision {item.pinnedRevisionId}
              {item.revokedAt === null ? '' : ' (revoked)'}
            </span>
            {item.revokedAt === null ? (
              <span className="notes-share-actions">
                <Button variant="secondary" onClick={() => void update(item)}>
                  Update publication
                </Button>
                <Button variant="danger" onClick={() => void revoke(item)}>
                  Revoke
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
