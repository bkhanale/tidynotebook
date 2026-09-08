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
  const [isOpen, setIsOpen] = useState(false);
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
    } else {
      const accountId = session.account?.accountId;
      if (localStore.store !== null && accountId !== undefined) {
        try {
          const localNote = await localStore.store.readCachedNote(
            accountId,
            workspaceId,
            fileId,
          );
          if (localNote !== null && localNote.baseRevisionId !== null) {
            setHead({
              revisionId: localNote.baseRevisionId,
              text: localNote.text,
            });
          }
        } catch {
          // Local read fallback is optional.
        }
      }
    }
    if (sharesResult.data !== undefined)
      setShares(
        sharesResult.data.shares.filter((share) => share.fileId === fileId),
      );
  }, [fileId, localStore.store, session.account?.accountId, workspaceId]);

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
    if (preview !== '') {
      setPreview('');
      return;
    }
    let textToRender = head?.text ?? null;
    if (textToRender === null) {
      const accountId = session.account?.accountId;
      if (localStore.store !== null && accountId !== undefined) {
        try {
          const localNote = await localStore.store.readCachedNote(
            accountId,
            workspaceId,
            fileId,
          );
          if (localNote !== null) {
            textToRender = localNote.text;
          }
        } catch {
          // Ignore read error during preview fallback.
        }
      }
    }
    if (textToRender === null) {
      setMessage('No accepted revision is available to preview.');
      return;
    }
    if (textToRender.trim() === '') {
      setPreview('<p><em>(Empty note)</em></p>');
      return;
    }
    const { renderMarkdown } = await import('@notesapp/markdown');
    const html = await renderMarkdown(textToRender);
    setPreview(html || '<p><em>(Empty note)</em></p>');
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
    <div className="notes-share-popover-container">
      <Button
        variant={isOpen ? 'secondary' : 'ghost'}
        size="sm"
        aria-expanded={isOpen}
        aria-label="Public sharing"
        onClick={() => setIsOpen((open) => !open)}
      >
        Public sharing
      </Button>
      {isOpen ? (
        <div
          className="notes-share-popover"
          role="dialog"
          aria-label="Public sharing"
        >
          <div className="notes-share-dialog-header">
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
              Public sharing
            </h3>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close"
              onClick={() => setIsOpen(false)}
            >
              Close
            </Button>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              color: 'var(--notes-text-muted)',
            }}
          >
            Publication pins an accepted revision. Saving later changes does not
            update a public link.
          </p>
          <div>
            <label
              className="notes-label"
              htmlFor="share-expiry"
              style={{
                fontSize: '0.85rem',
                marginBottom: '4px',
                display: 'block',
              }}
            >
              Optional expiry
            </label>
            <input
              id="share-expiry"
              className="notes-input"
              type="datetime-local"
              value={expires}
              onChange={(event) => setExpires(event.target.value)}
            />
          </div>
          <div className="notes-share-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void showPreview()}
            >
              {preview === '' ? 'Preview accepted revision' : 'Hide preview'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void publish()}
              disabled={head === null}
            >
              Publish new link
            </Button>
          </div>
          {message === '' ? null : <StatusRegion message={message} />}
          {createdUrl === '' ? null : (
            <p
              style={{
                margin: 0,
                wordBreak: 'break-all',
                fontSize: '0.85rem',
              }}
            >
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
          {shares.length > 0 ? (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {shares.map((item) => (
                <li
                  key={item.shareId}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    padding: '8px',
                    background: 'var(--notes-bg-subtle)',
                    borderRadius: 'var(--notes-radius-md)',
                    fontSize: '0.85rem',
                  }}
                >
                  <span style={{ color: 'var(--notes-text-muted)' }}>
                    Revision {item.pinnedRevisionId}
                    {item.revokedAt === null ? '' : ' (revoked)'}
                  </span>
                  {item.revokedAt === null ? (
                    <div className="notes-share-actions" style={{ margin: 0 }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void update(item)}
                      >
                        Update publication
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void revoke(item)}
                      >
                        Revoke
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
