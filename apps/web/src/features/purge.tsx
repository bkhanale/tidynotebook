/**
 * Deletion history and permanent purge.
 *
 * This owner-only screen lists live files, shows the deletion markers of
 * selected files, previews a purge with its blocking references, and runs
 * the purge after an explicit confirmation. A content-free purge marker stays
 * until workspace deletion, late writes to a purged ID answer 410, and
 * encrypted backups keep copies until their retention ends.
 *
 * After a purge, captured note text can be created again explicitly under a
 * new file ID. That recovery copy is a new file: it is never labeled a server
 * restore and it never calls the restore operation. When a purge is
 * rejected, nothing is deleted and local work on this device stays unchanged.
 *
 * Every server action uses a generated operation. There is no handwritten
 * request, URL, or response shape here.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  createFile,
  getFile,
  listFiles,
  listHistory,
  previewPurge,
  purgeFiles,
  type HistoryRevisionItem,
  type PurgePreview,
  type WorkspaceFileSummary,
} from '@notesapp/api-client';
import { generateUUID, normalizePath } from '@notesapp/core';
import type { LocalStore } from '@notesapp/sync';
import { Button, StatusRegion, TextField } from '@notesapp/ui';
import { problemMessage, useLocalStore, useSession } from '../app.tsx';
import { findWorkspace, useWorkspaces } from './workspaces.tsx';

/** The deletion markers known for one file. */
type DeletionHistory =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'purged' }
  | { readonly status: 'unknown' }
  | {
      readonly status: 'ready';
      readonly markers: readonly HistoryRevisionItem[];
    };

/** Note text captured before a purge for an explicit recovery copy. */
type CapturedText = {
  readonly fileId: string;
  readonly path: string;
  readonly text: string;
  readonly recoveryPath: string;
  readonly createdFileId: string | null;
  readonly error: string | null;
};

/**
 * Permanent deletion of one workspace.
 *
 * Route params name the workspace. Only the owner may purge; other roles see
 * a notice and no controls.
 */
export function PurgeView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const session = useSession();
  const store = useLocalStore();
  const { state } = useWorkspaces();

  if (workspaceId === null)
    return (
      <main>
        <h1>Deletion not found</h1>
        <p>The address names no workspace.</p>
        <p>
          <Link to="/">Back to workspaces.</Link>
        </p>
      </main>
    );
  if (session.account === null)
    return (
      <main>
        <StatusRegion message="Loading the deletion screen." />
      </main>
    );
  const role =
    state.status === 'ready'
      ? (findWorkspace(state.workspaces, workspaceId)?.role ?? null)
      : null;
  if (role !== 'owner')
    return (
      <main>
        <h1>Deletion and purge</h1>
        <p>
          {role === null
            ? 'Loading the workspace role.'
            : 'Permanent purge is an owner action. Other roles cannot preview or run it.'}
        </p>
        <p>
          <Link to={`/w/${workspaceId}`}>Back to the workspace.</Link>
        </p>
      </main>
    );
  return <PurgeDetail store={store.store} workspaceId={workspaceId} />;
}

/** Loads files, deletion markers, previews, and runs the purge. */
function PurgeDetail({
  store,
  workspaceId,
}: {
  readonly store: LocalStore | null;
  readonly workspaceId: string;
}): ReactNode {
  const [files, setFiles] = useState<readonly WorkspaceFileSummary[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [manualId, setManualId] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [deletions, setDeletions] = useState<
    ReadonlyMap<string, DeletionHistory>
  >(new Map());
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [captured, setCaptured] = useState<readonly CapturedText[]>([]);

  /** Loads every live file of the workspace. */
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const loaded: WorkspaceFileSummary[] = [];
      let cursor: string | null = null;
      let first = true;
      for (;;) {
        const query: { readonly cursor?: string; readonly limit?: number } =
          first || cursor === null ? { limit: 100 } : { cursor, limit: 100 };
        const result = await listFiles({
          path: { workspaceId },
          query: { ...query },
        });
        if (cancelled) return;
        if (result.error !== undefined || result.data === undefined) {
          setFilesError(problemMessage(result.error));
          return;
        }
        loaded.push(...result.data.files);
        if (result.data.nextCursor === null) break;
        cursor = result.data.nextCursor;
        first = false;
      }
      if (!cancelled) {
        setFiles(loaded);
        setFilesError(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  /** Loads the deletion markers of every selected file. */
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const next = new Map<string, DeletionHistory>();
      for (const fileId of selected) {
        next.set(fileId, { status: 'loading' });
      }
      setDeletions(next);
      for (const fileId of selected) {
        const result = await listHistory({
          path: { workspaceId, fileId },
          query: { limit: 100 },
        });
        if (cancelled) return;
        if (result.error !== undefined || result.data === undefined) {
          const code = result.response?.status ?? 0;
          const history: DeletionHistory =
            code === 410
              ? { status: 'purged' }
              : code === 404
                ? { status: 'unknown' }
                : { status: 'error', message: problemMessage(result.error) };
          setDeletions((current) => new Map(current).set(fileId, history));
          continue;
        }
        const markers = result.data.revisions.filter((entry) => entry.deleted);
        setDeletions((current) =>
          new Map(current).set(fileId, { status: 'ready', markers }),
        );
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, selected]);

  /** Toggles one file in the purge set and clears a stale preview. */
  function toggle(fileId: string): void {
    setSelected((current) =>
      current.includes(fileId)
        ? current.filter((entry) => entry !== fileId)
        : [...current, fileId],
    );
    setPreview(null);
    setPreviewError(null);
    setConfirmed(false);
    setOutcome(null);
    setFailure(null);
  }

  /** Adds a manually named file ID to the purge set. */
  function addManual(): void {
    const id = manualId.trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
      setManualError('Name a file UUID, for example a deleted file ID.');
      return;
    }
    setManualError(null);
    setManualId('');
    if (!selected.includes(id)) toggle(id);
  }

  /** Previews the purge of the selected files with blockers. */
  async function runPreview(): Promise<void> {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setPreviewError(null);
    const result = await previewPurge({
      path: { workspaceId },
      body: { fileIds: [...selected] },
    });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      setPreviewError(problemMessage(result.error));
      return;
    }
    setPreview(result.data);
    setConfirmed(false);
  }

  /** Captures the current note text of every selected file. */
  async function captureText(
    fileIds: readonly string[],
  ): Promise<CapturedText[]> {
    const out: CapturedText[] = [];
    for (const fileId of fileIds) {
      const fetched = await getFile({ path: { workspaceId, fileId } });
      if (fetched.error !== undefined || fetched.data === undefined) continue;
      const text = fetched.data.head?.text ?? null;
      if (text === null) continue;
      out.push({
        fileId,
        path: fetched.data.path,
        text,
        recoveryPath: fetched.data.path,
        createdFileId: null,
        error: null,
      });
    }
    return out;
  }

  /** Runs the purge after preview and confirmation. */
  async function runPurge(): Promise<void> {
    if (preview === null || !preview.canPurge || !confirmed || busy) return;
    setBusy(true);
    setFailure(null);
    const texts = await captureText(selected);
    setCaptured(texts);
    const result = await purgeFiles({
      path: { workspaceId },
      body: { mutationId: generateUUID(), fileIds: [...selected] },
    });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      setFailure(
        `The purge is rejected and nothing is deleted: ${problemMessage(result.error)}. Local drafts and queued work on this device stay unchanged.`,
      );
      return;
    }
    setOutcome(
      `Purged ${String(result.data.purgedFileIds.length)} file(s) and reclaimed ${String(result.data.reclaimedBytes)} byte(s). The old IDs can never be written again; pending local work for them stays on this device for recovery into a new file ID.`,
    );
    setPreview(null);
    setConfirmed(false);
  }

  /** Creates one recovery copy under a new file ID. */
  async function createRecoveryCopy(entry: CapturedText): Promise<void> {
    const pathCheck = normalizePath(entry.recoveryPath, 'note');
    if (!pathCheck.ok) {
      setCaptured((current) =>
        current.map((item) =>
          item.fileId === entry.fileId
            ? { ...item, error: 'Name a valid relative .md path.' }
            : item,
        ),
      );
      return;
    }
    const fileId = generateUUID();
    const result = await createFile({
      path: { workspaceId },
      body: {
        fileId,
        path: pathCheck.value,
        text: entry.text,
        revisionId: generateUUID(),
        mutationId: generateUUID(),
        deviceId: store?.deviceId ?? 'web-device',
      },
    });
    if (result.error !== undefined || result.data === undefined) {
      setCaptured((current) =>
        current.map((item) =>
          item.fileId === entry.fileId
            ? { ...item, error: problemMessage(result.error) }
            : item,
        ),
      );
      return;
    }
    setCaptured((current) =>
      current.map((item) =>
        item.fileId === entry.fileId
          ? { ...item, createdFileId: fileId, error: null }
          : item,
      ),
    );
  }

  return (
    <main>
      <h1>Deletion and purge</h1>
      <p>
        <Link to={`/w/${workspaceId}`}>Back to the workspace.</Link>
        {' | '}
        <Link to={`/w/${workspaceId}/conflicts`}>Conflicts.</Link>
      </p>
      <p>
        Purge permanently deletes files: their revisions, branches, shares, and
        bytes. A content-free purge marker stays until workspace deletion, so
        late writes to a purged ID answer 410 instead of recreating the file.
        Encrypted backups keep copies until their retention ends: seven daily
        and four weekly copies on separate storage.
      </p>
      {outcome !== null ? <StatusRegion message={outcome} /> : null}
      {failure !== null ? (
        <p className="notes-status-error" role="alert">
          {failure}
        </p>
      ) : null}

      <section aria-labelledby="purge-files-heading">
        <h2 id="purge-files-heading">Files</h2>
        {filesError !== null ? (
          <p className="notes-status-error" role="alert">
            {filesError}
          </p>
        ) : null}
        {files.length === 0 && filesError === null ? (
          <p>No live files are listed in this workspace.</p>
        ) : (
          <ol>
            {files.map((file) => (
              <li key={file.fileId}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(file.fileId)}
                    onChange={(): void => {
                      toggle(file.fileId);
                    }}
                  />
                  {`${file.path} (${file.fileId})`}
                </label>
              </li>
            ))}
          </ol>
        )}
        <TextField
          id="notes-manual-file-id"
          label="Add a file ID that is no longer listed, for example a deleted file"
          value={manualId}
          onChange={setManualId}
          error={manualError ?? undefined}
        />
        <Button
          variant="secondary"
          label="Add the named file ID to the purge set"
          onClick={addManual}
        >
          Add the file ID
        </Button>
      </section>

      <section aria-labelledby="purge-deletions-heading">
        <h2 id="purge-deletions-heading">Deletion history</h2>
        {selected.length === 0 ? (
          <p>Select files above to see their deletion markers.</p>
        ) : (
          <ol>
            {selected.map((fileId) => {
              const history = deletions.get(fileId) ?? {
                status: 'loading' as const,
              };
              return (
                <li key={fileId}>
                  <h3>{fileId}</h3>
                  {history.status === 'loading' ? (
                    <StatusRegion message="Loading the deletion markers." />
                  ) : history.status === 'error' ? (
                    <p className="notes-status-error" role="alert">
                      {history.message}
                    </p>
                  ) : history.status === 'purged' ? (
                    <p>
                      This file is already purged: its history is gone and its
                      ID can never be written again.
                    </p>
                  ) : history.status === 'unknown' ? (
                    <p>
                      The server knows no file with that ID in this workspace.
                    </p>
                  ) : history.markers.length === 0 ? (
                    <p>No deletion markers are recorded for this file.</p>
                  ) : (
                    <ol>
                      {history.markers.map((marker) => (
                        <li key={marker.revisionId}>
                          {`Deletion marker ${marker.revisionId}, saved ${marker.serverTime}`}
                          {marker.message !== null
                            ? `, named ${marker.message}`
                            : ''}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="purge-preview-heading">
        <h2 id="purge-preview-heading">Purge preview and confirmation</h2>
        <Button
          variant="secondary"
          label="Preview the purge of the selected files"
          disabled={selected.length === 0 || busy}
          onClick={() => {
            void runPreview();
          }}
        >
          Preview the purge
        </Button>
        {previewError !== null ? (
          <p className="notes-status-error" role="alert">
            {previewError}
          </p>
        ) : null}
        {preview !== null ? (
          <div>
            <p>
              {`The purge would remove ${String(preview.revisionIds.length)} revision(s) of ${String(preview.fileIds.length)} file(s) and reclaim ${String(preview.reclaimableBytes)} byte(s). ${String(preview.dependentRevisionCount)} dependent revision(s) refer to this set.`}
            </p>
            {preview.attachmentObjectIds.length > 0 ? (
              <p>
                {`Attachment objects: ${preview.attachmentObjectIds.join(', ')}.`}
              </p>
            ) : null}
            {preview.blockingReferences.length === 0 ? (
              <p>No blocking references.</p>
            ) : (
              <div>
                <h3>Blocking references</h3>
                <ol>
                  {preview.blockingReferences.map((blocker, index) => (
                    <li
                      key={`${blocker.kind}-${blocker.targetId}-${String(index)}`}
                    >
                      {`${blocker.kind} ${blocker.targetId} is kept by ${blocker.referrerId}: ${blocker.description}`}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {preview.canPurge ? (
              <div>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event): void => {
                      setConfirmed(event.target.checked);
                    }}
                  />
                  I understand this permanently deletes the selected files.
                </label>
                <Button
                  variant="danger"
                  label="Permanently purge the selected files"
                  disabled={!confirmed || busy}
                  onClick={() => {
                    void runPurge();
                  }}
                >
                  Purge the selected files
                </Button>
              </div>
            ) : (
              <p className="notes-status-error" role="alert">
                The purge cannot run while blocking references exist.
              </p>
            )}
          </div>
        ) : null}
      </section>

      {captured.length > 0 ? (
        <section aria-labelledby="purge-recovery-heading">
          <h2 id="purge-recovery-heading">Recovery copies</h2>
          <p>
            Each copy below creates a new file under a new ID from text captured
            on this device. A recovery copy is a new file, not a server restore:
            it carries no restored source and no old history.
          </p>
          <ol>
            {captured.map((entry) => (
              <li key={entry.fileId}>
                <h3>
                  {entry.createdFileId !== null
                    ? `Recovery copy of ${entry.path} created as ${entry.createdFileId}.`
                    : `Text captured from ${entry.path}.`}
                </h3>
                {entry.createdFileId === null ? (
                  <div>
                    <TextField
                      id={`notes-recovery-path-${entry.fileId}`}
                      label="Path of the recovery copy"
                      value={entry.recoveryPath}
                      onChange={(value: string) => {
                        setCaptured((current) =>
                          current.map((item) =>
                            item.fileId === entry.fileId
                              ? { ...item, recoveryPath: value }
                              : item,
                          ),
                        );
                      }}
                      error={entry.error ?? undefined}
                    />
                    <Button
                      variant="secondary"
                      label={`Create a recovery copy of ${entry.path} under a new file ID`}
                      onClick={() => {
                        void createRecoveryCopy(entry);
                      }}
                    >
                      Create a recovery copy under a new file ID
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
