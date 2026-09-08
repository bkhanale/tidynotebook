/**
 * File history, named checkpoints, old revision viewing, and restore.
 *
 * This screen shows one file in one pane: paginated server history with
 * checkpoint names, the pending local checkpoints of this device, one unified
 * inline diff between an old revision and the current head, and restore.
 * Attachment files offer binary revision selection with a preview of each
 * revision instead of a text merge.
 *
 * Opening history never changes the working draft. Restoring creates a new
 * revision on top of the current head and records the restored source; it
 * does not rewind history and it leaves drafts and queued checkpoints on this
 * device untouched.
 *
 * Every server action uses a generated operation. There is no handwritten
 * request, URL, or response shape here.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  createCheckpoint,
  getFile,
  getRevision,
  listHistory,
  restoreRevision,
  type HistoryRevisionItem,
} from '@notesapp/api-client';
import { generateUUID } from '@notesapp/core';
import { alignLines, type DiffHunk } from '@notesapp/editor';
import type { CheckpointRecord, LocalStore } from '@notesapp/sync';
import { Button, StatusRegion, TextField } from '@notesapp/ui';
import { problemMessage, useLocalStore, useSession } from '../app.tsx';
import { canWrite, findWorkspace, useWorkspaces } from './workspaces.tsx';
import {
  loadAttachmentBinary,
  type LoadedAttachment,
} from './attachment-content.ts';
import { requestDiff } from './diff-worker.ts';

/** How many history entries one page requests. */
const historyPageSize = 50;

/** One classified row of an inline hunk for screen readers and sighted users. */
type DiffRow = {
  readonly kind: 'context' | 'removed' | 'added';
  readonly text: string;
};

/**
 * Aligns the two sides of one hunk into display rows.
 *
 * The alignment is exact: every before line shows once as context or
 * removed, and every after line once as context or added, including
 * unchanged lines inside the changed region. When even that small alignment
 * exceeds its bound, every before line shows as removed and every after line
 * as added.
 */
function rowsOfHunk(hunk: DiffHunk): readonly DiffRow[] {
  const before = [...hunk.before];
  const after = [...hunk.after];
  const aligned = alignLines(before.join(''), after.join(''));
  if (aligned === null)
    return [
      ...before.map((line): DiffRow => ({ kind: 'removed', text: line })),
      ...after.map((line): DiffRow => ({ kind: 'added', text: line })),
    ];
  return aligned.map((entry): DiffRow => {
    if (entry.kind === 'same')
      return { kind: 'context', text: before[entry.beforeIndex] ?? '' };
    if (entry.kind === 'del')
      return { kind: 'removed', text: before[entry.beforeIndex] ?? '' };
    return { kind: 'added', text: after[entry.afterIndex] ?? '' };
  });
}

/**
 * One unified inline diff in the main pane.
 *
 * Hunks render in order with their 1-based line ranges. Removed lines carry a
 * minus prefix, added lines a plus prefix, and context lines a blank prefix.
 * The text of every line renders verbatim, including whitespace.
 */
export function InlineDiff({
  hunks,
  idPrefix,
  oldLabel,
  newLabel,
}: {
  readonly hunks: readonly DiffHunk[];
  readonly idPrefix: string;
  readonly oldLabel: string;
  readonly newLabel: string;
}): ReactNode {
  const rendered = useMemo(
    () =>
      hunks.map((hunk) => ({
        hunk,
        rows: rowsOfHunk(hunk),
      })),
    [hunks],
  );
  if (rendered.length === 0) return <p>No line differences.</p>;
  return (
    <ol className="notes-diff" aria-label="Line differences">
      {rendered.map((entry, index) => {
        const beforeCount = entry.hunk.before.length;
        const afterCount = entry.hunk.after.length;
        return (
          <li key={`${idPrefix}-hunk-${String(index)}`}>
            <h4>
              {`Hunk ${String(index + 1)}: ${oldLabel} from line ${String(entry.hunk.beforeStart)} (${String(beforeCount)} lines), ${newLabel} from line ${String(entry.hunk.afterStart)} (${String(afterCount)} lines)`}
            </h4>
            <ol>
              {entry.rows.map((row, rowIndex) => (
                <li
                  key={`${idPrefix}-hunk-${String(index)}-row-${String(rowIndex)}`}
                >
                  <span>
                    {row.kind === 'removed'
                      ? '− '
                      : row.kind === 'added'
                        ? '+ '
                        : '  '}
                  </span>
                  <code>{row.text === '' ? '(empty line)' : row.text}</code>
                </li>
              ))}
            </ol>
          </li>
        );
      })}
    </ol>
  );
}

/** The loaded file head behind the history. */
type FileHead =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'purged' }
  | { readonly status: 'unknown' }
  | {
      readonly status: 'ready';
      readonly path: string;
      readonly kind: 'note' | 'attachment';
      readonly headRevisionId: string | null;
      readonly headText: string;
      readonly etag: string | null;
    };

/** The state of the selected revision detail. */
type RevisionDetail =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly item: HistoryRevisionItem;
      readonly text: string;
    };

/** The state of the inline comparison. */
type DiffState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly hunks: readonly DiffHunk[] }
  | { readonly status: 'limit' }
  | { readonly status: 'error'; readonly message: string };

/**
 * The history of one file.
 *
 * Route params name the workspace and the file. Session, store, and role come
 * from the application providers, so this screen remounts cleanly when the
 * account changes.
 */
export function HistoryView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const fileId = typeof params.fileId === 'string' ? params.fileId : null;
  const session = useSession();
  const store = useLocalStore();
  const { state } = useWorkspaces();

  if (workspaceId === null || fileId === null)
    return (
      <main>
        <h1>History not found</h1>
        <p>The address names no file history.</p>
        <p>
          <Link to="/">Back to workspaces.</Link>
        </p>
      </main>
    );
  const accountId = session.account?.accountId ?? null;
  if (accountId === null)
    return (
      <main>
        <StatusRegion message="Loading the history." />
      </main>
    );
  const role =
    state.status === 'ready'
      ? (findWorkspace(state.workspaces, workspaceId)?.role ?? null)
      : null;
  return (
    <HistoryDetail
      store={store.store}
      accountId={accountId}
      workspaceId={workspaceId}
      fileId={fileId}
      role={role}
    />
  );
}

/** Loads the file head, the history pages, and the local checkpoints. */
function HistoryDetail({
  store,
  accountId,
  workspaceId,
  fileId,
  role,
}: {
  readonly store: LocalStore | null;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly fileId: string;
  readonly role: 'owner' | 'admin' | 'editor' | 'viewer' | null;
}): ReactNode {
  const [head, setHead] = useState<FileHead>({ status: 'loading' });
  const [items, setItems] = useState<readonly HistoryRevisionItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [local, setLocal] = useState<readonly CheckpointRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RevisionDetail | null>(null);
  const [diff, setDiff] = useState<DiffState>({ status: 'idle' });
  const [checkpointName, setCheckpointName] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<LoadedAttachment | null>(null);
  const [previewRevisionId, setPreviewRevisionId] = useState<string | null>(
    null,
  );
  const generationRef = useRef(0);

  const writable = role !== null && canWrite(role);

  /** Loads the file head once per file. */
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setHead({ status: 'loading' });
      const result = await getFile({ path: { workspaceId, fileId } });
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        const code = result.response?.status ?? 0;
        if (code === 410) setHead({ status: 'purged' });
        else if (code === 404) setHead({ status: 'unknown' });
        else
          setHead({ status: 'error', message: problemMessage(result.error) });
        return;
      }
      const file = result.data;
      setHead({
        status: 'ready',
        path: file.path,
        kind: file.kind,
        headRevisionId: file.headRevisionId,
        headText: file.head?.text ?? '',
        etag: result.response?.headers.get('etag') ?? null,
      });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, fileId]);

  /** Loads the first history page once per file. */
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setItems([]);
      setNextCursor(null);
      setHistoryError(null);
      const result = await listHistory({
        path: { workspaceId, fileId },
        query: { limit: historyPageSize },
      });
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        setHistoryError(problemMessage(result.error));
        return;
      }
      setItems(result.data.revisions);
      setNextCursor(result.data.nextCursor);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, fileId]);

  /** Loads the pending local checkpoints of this device. */
  useEffect(() => {
    if (store === null) {
      setLocal([]);
      return;
    }
    const activeStore = store;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const checkpoints = await activeStore.listCheckpoints(
          accountId,
          workspaceId,
          fileId,
        );
        if (!cancelled) setLocal(checkpoints);
      } catch {
        if (!cancelled) setLocal([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [store, accountId, workspaceId, fileId]);

  /** Revokes the attachment preview when it closes or changes. */
  useEffect(
    () => () => {
      preview?.dispose();
    },
    [preview],
  );

  /** Reloads the history pages from the start. */
  async function reloadHistory(): Promise<void> {
    const result = await listHistory({
      path: { workspaceId, fileId },
      query: { limit: historyPageSize },
    });
    if (result.error !== undefined || result.data === undefined) {
      setHistoryError(problemMessage(result.error));
      return;
    }
    setItems(result.data.revisions);
    setNextCursor(result.data.nextCursor);
    setHistoryError(null);
  }

  /** Loads the next history page, if the server offers one. */
  async function loadMore(): Promise<void> {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    const result = await listHistory({
      path: { workspaceId, fileId },
      query: { cursor: nextCursor, limit: historyPageSize },
    });
    setLoadingMore(false);
    if (result.error !== undefined || result.data === undefined) {
      setHistoryError(problemMessage(result.error));
      return;
    }
    setItems((current) => [...current, ...result.data.revisions]);
    setNextCursor(result.data.nextCursor);
  }

  /** Opens one revision: detail text, attachment preview, and inline diff. */
  async function openRevision(item: HistoryRevisionItem): Promise<void> {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setSelectedId(item.revisionId);
    setDetail({ status: 'loading' });
    setDiff({ status: 'loading' });
    setActionError(null);
    preview?.dispose();
    setPreview(null);
    setPreviewRevisionId(null);

    let text = item.text ?? '';
    if (item.text === null && !item.deleted && item.objectId === null) {
      const fetched = await getRevision({
        path: { workspaceId, revisionId: item.revisionId },
      });
      if (generation !== generationRef.current) return;
      if (fetched.error !== undefined || fetched.data === undefined) {
        setDetail({ status: 'error', message: problemMessage(fetched.error) });
        setDiff({ status: 'idle' });
        return;
      }
      text = fetched.data.text ?? '';
    }
    if (generation !== generationRef.current) return;
    setDetail({ status: 'ready', item, text });

    if (head.status === 'ready' && head.kind === 'note') {
      try {
        const compared = await requestDiff(text, head.headText);
        if (generation !== generationRef.current) return;
        if (compared.kind === 'complete')
          setDiff({ status: 'ready', hunks: compared.hunks });
        else setDiff({ status: 'limit' });
      } catch {
        if (generation === generationRef.current)
          setDiff({
            status: 'error',
            message: 'The comparison did not finish.',
          });
      }
    } else {
      setDiff({ status: 'idle' });
    }

    if (head.status === 'ready' && head.kind === 'attachment') {
      try {
        const loaded = await loadAttachmentBinary(
          workspaceId,
          item.revisionId,
          new AbortController().signal,
        );
        if (generation !== generationRef.current) {
          loaded.dispose();
          return;
        }
        setPreview(loaded);
        setPreviewRevisionId(item.revisionId);
      } catch {
        if (generation === generationRef.current) setPreview(null);
      }
    }
  }

  /** Tags the current head with a checkpoint name. */
  async function nameCheckpoint(): Promise<void> {
    if (head.status !== 'ready' || head.etag === null || busy) return;
    const name = checkpointName.trim();
    if (name === '') {
      setActionError('Name the checkpoint before saving it.');
      return;
    }
    setBusy(true);
    setActionError(null);
    const result = await createCheckpoint({
      headers: { 'if-match': head.etag },
      path: { workspaceId, fileId },
      body: {
        mutationId: generateUUID(),
        deviceId: store?.deviceId ?? 'web-device',
        clientTime: new Date().toISOString(),
        name,
      },
    });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      setActionError(problemMessage(result.error));
      return;
    }
    setCheckpointName('');
    setActionMessage(`Checkpoint ${name} now names the current head.`);
    await reloadHistory();
  }

  /** Restores one revision as a new child of the current head. */
  async function restore(targetRevisionId: string): Promise<void> {
    if (head.status !== 'ready' || head.headRevisionId === null || busy) return;
    setBusy(true);
    setActionError(null);
    const result = await restoreRevision({
      path: { workspaceId, fileId },
      body: {
        mutationId: generateUUID(),
        deviceId: store?.deviceId ?? 'web-device',
        clientTime: new Date().toISOString(),
        targetRevisionId,
        expectedHead: head.headRevisionId,
        revisionId: generateUUID(),
        message: null,
      },
    });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      setActionError(problemMessage(result.error));
      return;
    }
    setActionMessage(
      'The revision is restored as a new version. History is kept, and the draft on this device is unchanged.',
    );
    await reloadHistory();
  }

  if (head.status === 'loading')
    return (
      <main>
        <StatusRegion message="Loading the file history." />
      </main>
    );
  if (head.status === 'error')
    return (
      <main>
        <h1>History unavailable</h1>
        <p className="notes-status-error" role="alert">
          {head.message}
        </p>
      </main>
    );
  if (head.status === 'unknown')
    return (
      <main>
        <h1>Note not found</h1>
        <p>
          This file has no history in this workspace. It is not an empty note.
        </p>
        <p>
          <Link to={`/w/${workspaceId}`}>Back to the workspace.</Link>
        </p>
      </main>
    );
  if (head.status === 'purged')
    return (
      <main>
        <h1>Note permanently deleted</h1>
        <p>
          This file was purged by the workspace owner, so its server history is
          gone. Pending offline work for it stays on this device for recovery
          into a new file.
        </p>
        <p>
          <Link to={`/w/${workspaceId}`}>Back to the workspace.</Link>
        </p>
      </main>
    );

  const selectedItem =
    selectedId === null
      ? null
      : (items.find((entry) => entry.revisionId === selectedId) ?? null);
  return (
    <main>
      <h1>History of {head.path}</h1>
      <p>
        <Link to={`/w/${workspaceId}/notes/${fileId}`}>Back to the note.</Link>
        {' | '}
        <Link to={`/w/${workspaceId}/purge`}>Deletion and purge.</Link>
      </p>
      <p>
        Opening history never changes the working draft. Restoring creates a new
        revision on top of the current head and keeps every earlier revision.
      </p>
      {actionMessage !== '' ? <StatusRegion message={actionMessage} /> : null}
      {actionError !== null ? (
        <p className="notes-status-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <section aria-labelledby="history-server-heading">
        <h2 id="history-server-heading">Server history</h2>
        {historyError !== null ? (
          <p className="notes-status-error" role="alert">
            {historyError}
          </p>
        ) : null}
        {items.length === 0 && historyError === null ? (
          <p>No server revisions are listed for this file yet.</p>
        ) : (
          <ol>
            {items.map((item) => (
              <li key={item.revisionId}>
                <Button
                  variant="secondary"
                  label={`Open revision ${item.revisionId}`}
                  onClick={() => {
                    void openRevision(item);
                  }}
                >
                  {describeRevision(item)}
                </Button>
              </li>
            ))}
          </ol>
        )}
        {nextCursor !== null ? (
          <Button
            variant="secondary"
            label="Load older history entries"
            disabled={loadingMore}
            onClick={() => {
              void loadMore();
            }}
          >
            {loadingMore ? 'Loading older entries.' : 'Load older entries'}
          </Button>
        ) : null}
      </section>

      <section aria-labelledby="history-local-heading">
        <h2 id="history-local-heading">Pending history on this device</h2>
        {store === null ? (
          <p>
            Local storage is unavailable, so this device keeps no local
            checkpoints.
          </p>
        ) : local.length === 0 ? (
          <p>No local checkpoints wait for this file on this device.</p>
        ) : (
          <ol>
            {local.map((entry) => (
              <li key={entry.revisionId}>
                {`Revision ${entry.revisionId} from ${entry.clientTime}`}
                {entry.message !== null ? ` named ${entry.message}` : ''}
                {entry.accepted ? ' (saved to server)' : ' (waiting to send)'}
              </li>
            ))}
          </ol>
        )}
      </section>

      {writable ? (
        <section aria-labelledby="history-checkpoint-heading">
          <h2 id="history-checkpoint-heading">Name the current version</h2>
          {head.etag === null ? (
            <p>
              The current version carries no entity tag, so a named checkpoint
              cannot be saved right now.
            </p>
          ) : (
            <div>
              <TextField
                id="notes-checkpoint-name"
                label="Checkpoint name"
                value={checkpointName}
                onChange={setCheckpointName}
              />
              <Button
                variant="primary"
                label="Save a named checkpoint of the current head"
                disabled={busy}
                onClick={() => {
                  void nameCheckpoint();
                }}
              >
                Save a named checkpoint
              </Button>
            </div>
          )}
        </section>
      ) : (
        <p>Naming checkpoints and restoring need a writer role.</p>
      )}

      {selectedItem !== null ? (
        <section aria-labelledby="history-revision-heading">
          <h2 id="history-revision-heading">Selected revision</h2>
          {detail === null || detail.status === 'loading' ? (
            <StatusRegion message="Loading the selected revision." />
          ) : detail.status === 'error' ? (
            <p className="notes-status-error" role="alert">
              {detail.message}
            </p>
          ) : (
            <div>
              <p>{describeRevision(detail.item)}</p>
              {head.kind === 'attachment' ? (
                <div>
                  {preview !== null &&
                  previewRevisionId === detail.item.revisionId ? (
                    <img
                      src={preview.url}
                      alt={`Preview of revision ${detail.item.revisionId}`}
                    />
                  ) : (
                    <p>That revision has no preview on this device.</p>
                  )}
                </div>
              ) : (
                <div>
                  <h3>Old text of the selected revision</h3>
                  <pre>{detail.text}</pre>
                  <h3>
                    Changes from the selected revision to the current head
                  </h3>
                  {diff.status === 'idle' ? (
                    <p>The comparison is not available for this file.</p>
                  ) : diff.status === 'loading' ? (
                    <StatusRegion message="Comparing the two versions." />
                  ) : diff.status === 'ready' ? (
                    <InlineDiff
                      hunks={diff.hunks}
                      idPrefix={`history-${detail.item.revisionId}`}
                      oldLabel="Selected revision"
                      newLabel="Current head"
                    />
                  ) : diff.status === 'limit' ? (
                    <p>
                      The two versions differ by more than the comparison limit,
                      so no inline diff is shown. Open the old text above, or
                      restore the whole revision below.
                    </p>
                  ) : (
                    <p className="notes-status-error" role="alert">
                      {diff.message}
                    </p>
                  )}
                </div>
              )}
              {writable ? (
                <Button
                  variant="primary"
                  label={`Restore revision ${detail.item.revisionId} as a new version`}
                  disabled={busy || head.headRevisionId === null}
                  onClick={() => {
                    void restore(detail.item.revisionId);
                  }}
                >
                  Restore this revision as a new version
                </Button>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

/** One readable line for a history entry. */
function describeRevision(item: HistoryRevisionItem): string {
  const parts = [`Revision ${item.revisionId}`, `saved ${item.serverTime}`];
  if (item.isCheckpoint && item.checkpointName !== null)
    parts.push(`checkpoint ${item.checkpointName}`);
  else if (item.message !== null) parts.push(`named ${item.message}`);
  if (item.deleted) parts.push('deletion marker');
  if (item.restoredFrom !== null)
    parts.push(`restored from ${item.restoredFrom}`);
  if (item.objectId !== null) parts.push('attachment version');
  return parts.join(', ');
}
