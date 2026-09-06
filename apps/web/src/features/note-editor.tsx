/**
 * The one-pane note editor screen.
 *
 * One mounted `NoteEditor` owns exactly one CodeMirror view and one working
 * copy. Editor changes flow into `LocalStore.saveDraft` within about 120 ms
 * and into immutable checkpoints through the shared scheduler: 750 ms idle,
 * every 30 s of continuous editing, Save, and file leave. The React tree may
 * rerender and the theme may change as often as it wants; neither replaces
 * the editor document, so undo history, IME composition, selection, and
 * clipboard content survive them.
 *
 * File identity follows the local-first rule. Edits, renames, and deletes
 * are drafts and checkpoints; the foreground sync engine submits them with
 * generated operations. This screen never calls `fetch` and never builds a
 * request URL by hand.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  finalizeAttachment,
  getFile,
  uploadAttachment,
} from '@notesapp/api-client';
import {
  createCheckpointScheduler,
  isLocalStorageError,
  type CheckpointScheduler,
  type Draft,
  type LocalStore,
  type LocalStorageErrorKind,
  type QueueEntry,
} from '@notesapp/sync';
import {
  createEditor,
  setEditorRich,
  setEditorTheme,
  type EditorView,
  type LinkTarget,
  type RichWidgetResolvers,
} from '@notesapp/editor';
import { Button, StatusRegion } from '@notesapp/ui';
import { problemMessage, useTheme } from '../app.tsx';
import { canWrite } from './workspaces.tsx';
import { createAttachmentLoader } from './attachment-content.ts';
import { createDiagramFrame } from '../diagram/frame.ts';
import { stableNoteLink, type StableLinkRequest } from './search.tsx';
import {
  resolveSaveState,
  SaveStatus,
  useBlockUnsafeReload,
  type SaveState,
} from './save-status.tsx';

/** Draft writes trail input by this long, inside the 150 ms target. */
const draftSaveDelayMs = 120;

/**
 * The built diagram frame document.
 *
 * A plain path string on purpose: this names a static Vite entry, not an
 * application API route, so it stays a literal instead of constructed URL.
 */
const diagramFramePath = '/src/diagram/frame.html';

/** Attachment revision references in stored Markdown. */
const attachmentReferencePattern = /\/attachments\/([0-9a-fA-F-]{36})/g;

/** Largest pasted file the editor uploads directly, matching the server cap. */
const maxPastedBytes = 20 * 1024 * 1024;

/** The revision IDs referenced by one Markdown source, deduplicated. */
function extractAttachmentIds(text: string): string[] {
  const found: string[] = [];
  attachmentReferencePattern.lastIndex = 0;
  for (;;) {
    const match = attachmentReferencePattern.exec(text);
    if (match === null) return found;
    const id = match[1] ?? '';
    if (id !== '' && !found.includes(id)) found.push(id);
  }
}

/** Makes a pasted file name safe for an attachment path segment. */
function sanitizeAttachmentName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' || cleaned === '.' || cleaned === '..'
    ? 'pasted-image'
    : cleaned;
}

/**
 * Reads the Mermaid source out of one fenced widget source.
 *
 * Drops the opening fence line and the closing fence line, keeping the inner
 * text verbatim for the isolated frame.
 */
function diagramInnerSource(fence: string): string {
  const lines = fence.split('\n');
  lines.shift();
  while (lines.length > 0) {
    const last = lines.at(-1) ?? '';
    const trimmed = last.trim();
    if (trimmed === '' || /^(```+|~~~+)/.test(trimmed)) lines.pop();
    else break;
  }
  return lines.join('\n');
}

/** How often the screen re-reads the local queue for save feedback. */
const queuePollMs = 5_000;

/** A fresh file carried through navigation state, read without trust. */
type FreshFileState = {
  readonly fresh: true;
  readonly fileId: string;
  readonly initialText: string;
  readonly initialPath: string;
};

/** Reads navigation state only when it proves to be a fresh file handoff. */
function readFreshState(value: unknown, fileId: string): FreshFileState | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record['fresh'] !== true) return null;
  if (record['fileId'] !== fileId) return null;
  if (typeof record['initialText'] !== 'string') return null;
  if (typeof record['initialPath'] !== 'string') return null;
  return {
    fresh: true,
    fileId,
    initialText: record['initialText'],
    initialPath: record['initialPath'],
  };
}

/** Copies text to the clipboard, staying false when it is unavailable. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false;
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Props of the editing surface. `initialText` is read once at mount. */
export type NoteEditorProps = {
  readonly store: LocalStore;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly fileId: string;
  readonly baseRevisionId: string | null;
  readonly initialText: string;
  readonly initialPath: string;
  readonly readOnly: boolean;
  readonly onOpenLink?: ((target: LinkTarget) => void) | undefined;
  readonly onQueued?: ((entry: QueueEntry | null) => void) | undefined;
};

/**
 * The live editing surface of one file.
 *
 * The editor view is created once per working copy and destroyed when the
 * copy closes. Later renders never touch its document: renames and deletes
 * checkpoint through the store, theme changes reconfigure one compartment,
 * and link targets leave through the navigation callback.
 */
export function NoteEditor({
  store,
  accountId,
  workspaceId,
  fileId,
  baseRevisionId,
  initialText,
  initialPath,
  readOnly,
  onOpenLink,
  onQueued,
}: NoteEditorProps): ReactNode {
  const { resolved } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const schedulerRef = useRef<CheckpointScheduler | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const bufferRef = useRef(initialText);
  const pathRef = useRef(initialPath);
  const sequenceRef = useRef(0);
  const lastMutationRef = useRef<string | null>(null);
  const [path, setPath] = useState(initialPath);
  const [bufferText, setBufferText] = useState(initialText);
  const [draftPending, setDraftPending] = useState(false);
  const [queueLength, setQueueLength] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [storageError, setStorageError] =
    useState<LocalStorageErrorKind | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pasteNotice, setPasteNotice] = useState('');
  const [attachmentUrls, setAttachmentUrls] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const [mathReady, setMathReady] = useState(false);
  const workingCopyId = useMemo(() => crypto.randomUUID(), []);
  const mathRenderRef = useRef<
    ((source: string, display: boolean) => string) | null
  >(null);
  const ownedUrlsRef = useRef<
    Map<string, { url: string; dispose: () => void }>
  >(new Map());
  const loaderRef = useRef(createAttachmentLoader(workspaceId));
  loaderRef.current = createAttachmentLoader(workspaceId);

  const live = useRef({
    store,
    accountId,
    workspaceId,
    fileId,
    baseRevisionId,
    workingCopyId,
    readOnly,
  });
  live.current = {
    store,
    accountId,
    workspaceId,
    fileId,
    baseRevisionId,
    workingCopyId,
    readOnly,
  };
  const callbacks = useRef({ onOpenLink, onQueued });
  callbacks.current = { onOpenLink, onQueued };
  const themeRef = useRef(resolved);
  themeRef.current = resolved;

  /** The draft the store would write right now. */
  const buildDraft = (deleted: boolean): Draft => {
    const current = live.current;
    return {
      accountId: current.accountId,
      workspaceId: current.workspaceId,
      workingCopyId: current.workingCopyId,
      fileId: current.fileId,
      baseRevisionId: current.baseRevisionId,
      text: bufferRef.current,
      path: pathRef.current,
      deleted,
      sequence: sequenceRef.current,
    };
  };

  /** Re-reads the queue so the status names conflicts and acknowledgments. */
  const refreshQueue = useRef((): Promise<void> => Promise.resolve());
  refreshQueue.current = async (): Promise<void> => {
    const current = live.current;
    try {
      const entries = await current.store.pending(
        current.accountId,
        current.workspaceId,
      );
      const ids = new Set(entries.map((entry) => entry.input.mutationId));
      setQueueLength(entries.length);
      setConflicts(
        entries.filter((entry) => entry.state === 'conflict').length,
      );
      const newest = lastMutationRef.current;
      setAcknowledged(
        newest === null ? entries.length === 0 : !ids.has(newest),
      );
    } catch {
      // Queue reads are feedback only. A failure here must not disturb the
      // buffer, the draft, or the checkpoint timers.
    }
  };

  /** Writes the current buffer as the working draft. */
  const saveDraftNow = useRef((): Promise<void> => Promise.resolve());
  saveDraftNow.current = async (): Promise<void> => {
    const current = live.current;
    const savedSequence = sequenceRef.current;
    setDraftPending(true);
    try {
      await current.store.saveDraft(buildDraft(false));
      // A newer keystroke may have arrived while the write ran; only that
      // newer write clears the pending flag.
      if (sequenceRef.current === savedSequence) setDraftPending(false);
      setStorageError(null);
    } catch (failure: unknown) {
      setDraftPending(false);
      setStorageError(isLocalStorageError(failure) ? failure.kind : 'aborted');
    }
  };

  /** Creates one immutable checkpoint from the current buffer. */
  const checkpointNow = useRef((): Promise<void> => Promise.resolve());
  checkpointNow.current = async (): Promise<void> => {
    const current = live.current;
    try {
      const entry = await current.store.checkpoint(buildDraft(false), null);
      if (entry !== null) lastMutationRef.current = entry.input.mutationId;
      callbacks.current.onQueued?.(entry);
      setStorageError(null);
      await refreshQueue.current();
    } catch (failure: unknown) {
      setStorageError(isLocalStorageError(failure) ? failure.kind : 'aborted');
    }
  };

  // The checkpoint scheduler of this working copy. Real timers drive the
  // design's 750 ms idle and 30 s interval rules through the shared pure
  // scheduler from the sync package.
  useEffect(() => {
    const insertStableLink = (event: Event): void => {
      const detail = (event as CustomEvent<StableLinkRequest>).detail;
      const view = viewRef.current;
      if (view === null || readOnly) return;
      const selection = view.state.selection.main;
      if (selection.empty) {
        setPasteNotice('Select text before you insert a stable note link.');
        return;
      }
      const selected = view.state.doc.sliceString(selection.from, selection.to);
      const value = stableNoteLink({
        fileId: detail.fileId,
        label: selected === '' ? detail.label : selected,
      });
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: value },
        selection: { anchor: selection.from + value.length },
        userEvent: 'input.complete',
      });
      view.focus();
      setPasteNotice('Stable note link inserted.');
    };
    window.addEventListener('notesapp:insert-link', insertStableLink);
    return () => {
      window.removeEventListener('notesapp:insert-link', insertStableLink);
    };
  }, [readOnly]);

  useEffect(() => {
    const scheduler = createCheckpointScheduler({
      now: () => Date.now(),
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: (handle) => {
        window.clearTimeout(handle as number);
      },
      onCheckpoint: () => {
        void checkpointNow.current();
      },
    });
    schedulerRef.current = scheduler;
    void refreshQueue.current();
    const polling = window.setInterval(() => {
      void refreshQueue.current();
    }, queuePollMs);
    return () => {
      window.clearInterval(polling);
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // The leave-file checkpoint. Drafts already hold the text, so even if
      // this late write loses a race the queued checkpoints stay complete.
      scheduler.stop();
      void checkpointNow.current();
      schedulerRef.current = null;
    };
  }, [workingCopyId]);

  // The KaTeX renderer loads after the first paint, so the initial bundle
  // stays inside its budget. Widgets show a loading placeholder until it
  // arrives; the rich compartment below refreshes them without touching the
  // document. The chunk is retained for later offline precaching.
  useEffect(() => {
    let cancelled = false;
    void import('@notesapp/markdown').then((module) => {
      if (cancelled) return;
      mathRenderRef.current = module.renderMath;
      setMathReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolves attachment revision IDs in the current text to local object
  // URLs through the generated binary operation. Old revision selections
  // load their own bytes. URLs that leave the text are revoked, and every
  // remaining URL is revoked when the working copy closes.
  useEffect(() => {
    const loader = loaderRef.current;
    const wanted = extractAttachmentIds(bufferText);
    const owned = ownedUrlsRef.current;
    for (const [id, entry] of owned) {
      if (!wanted.includes(id)) {
        entry.dispose();
        owned.delete(id);
      }
    }
    if (wanted.every((id) => owned.has(id))) {
      setAttachmentUrls(
        new Map([...owned].map(([id, entry]) => [id, entry.url] as const)),
      );
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void (async (): Promise<void> => {
      for (const id of wanted) {
        if (cancelled || owned.has(id)) continue;
        try {
          const loaded = await loader.loadAttachment(id, controller.signal);
          if (cancelled) {
            loaded.dispose();
            continue;
          }
          owned.set(id, { url: loaded.url, dispose: loaded.dispose });
        } catch {
          // A missing or denied revision stays a fallback in its widget;
          // the text itself is untouched.
        }
      }
      if (!cancelled)
        setAttachmentUrls(
          new Map([...owned].map(([id, entry]) => [id, entry.url] as const)),
        );
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [workspaceId, bufferText]);

  // Revokes every remaining object URL when the working copy closes.
  useEffect(
    () => () => {
      for (const entry of ownedUrlsRef.current.values()) entry.dispose();
      ownedUrlsRef.current.clear();
    },
    [],
  );

  /** The resolvers the widget extension renders with right now. */
  const richResolvers = useMemo<RichWidgetResolvers>(
    () => ({
      renderMath:
        mathRenderRef.current === null
          ? undefined
          : (source: string, display: boolean): string => {
              const render = mathRenderRef.current;
              if (render === null) throw new Error('Math is still loading.');
              return render(source, display);
            },
      resolveAttachment: (revisionId: string): string | null =>
        attachmentUrls.get(revisionId) ?? null,
      createDiagram: (fence: string): HTMLElement =>
        createDiagramFrame({
          source: diagramInnerSource(fence),
          theme: themeRef.current,
          framePath: diagramFramePath,
        }).element,
    }),
    [attachmentUrls, mathReady, resolved],
  );

  // Resolver changes reconfigure one compartment, keeping document, undo,
  // selection, and composition exactly where they are.
  useEffect(() => {
    const view = viewRef.current;
    if (view !== null) setEditorRich(view, richResolvers);
  }, [richResolvers]);

  // One editor instance per working copy. This effect never reruns for text,
  // path, or theme changes: those travel through transactions, the store, or
  // the compartments below.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const view = createEditor(
      container,
      bufferRef.current,
      (text) => {
        bufferRef.current = text;
        setBufferText(text);
        sequenceRef.current += 1;
        if (!live.current.readOnly) {
          setDraftPending(true);
          if (saveTimerRef.current !== null)
            window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null;
            void saveDraftNow.current();
          }, draftSaveDelayMs);
          schedulerRef.current?.onInput();
        }
      },
      {
        navigation: {
          onOpenLink: (target) => {
            callbacks.current.onOpenLink?.(target);
          },
        },
        onSave: () => {
          void (async (): Promise<void> => {
            if (saveTimerRef.current !== null) {
              window.clearTimeout(saveTimerRef.current);
              saveTimerRef.current = null;
            }
            await saveDraftNow.current();
            schedulerRef.current?.onSave();
          })();
        },
        readOnly: live.current.readOnly,
        theme: themeRef.current,
      },
    );
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [workingCopyId]);

  // Theme changes reconfigure one compartment, keeping document, undo,
  // selection, and composition exactly where they are.
  useEffect(() => {
    const view = viewRef.current;
    if (view !== null) setEditorTheme(view, resolved);
  }, [resolved]);

  const saveState: SaveState = resolveSaveState({
    draftWritePending: draftPending,
    queuedMutations: queueLength,
    conflictingMutations: conflicts,
    storageError,
    acknowledged,
  });
  // The buffer is the only copy until the draft commits, and it is the only
  // copy again when storage fails. Both cases block an unsafe reload.
  useBlockUnsafeReload(draftPending || storageError !== null);

  /** Inserts Markdown at the current cursor through an editor transaction. */
  const insertAtCursor = (text: string): void => {
    const view = viewRef.current;
    if (view === null) return;
    const { from, to } = view.state.selection.main;
    view.dispatch(view.state.update({ changes: { from, to, insert: text } }));
    view.focus();
  };

  /**
   * Uploads pasted or dropped image files with user supplied bytes.
   *
   * Each file is read locally first, uploaded through the generated
   * operation, finalized as an immutable attachment revision, and embedded
   * as `/attachments/<revisionId>`. No external URL is ever fetched through
   * the server: importing an external image means the user supplies its bytes
   * here. A failure keeps the buffer and reports a notice.
   */
  const uploadPastedFiles = (files: readonly File[]): void => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0 || live.current.readOnly) return;
    void (async (): Promise<void> => {
      const current = live.current;
      for (const file of images) {
        if (file.size > maxPastedBytes) {
          setPasteNotice(
            `The image ${file.name} is larger than 20 MiB and was not uploaded.`,
          );
          continue;
        }
        try {
          const uploaded = await uploadAttachment({
            path: { workspaceId: current.workspaceId },
            body: { file },
          });
          if (uploaded.error !== undefined || uploaded.data === undefined) {
            setPasteNotice(
              `The image ${file.name} did not upload: ${problemMessage(uploaded.error)}`,
            );
            continue;
          }
          const fileId = crypto.randomUUID();
          const revisionId = crypto.randomUUID();
          const safeName = sanitizeAttachmentName(file.name);
          const finalized = await finalizeAttachment({
            path: {
              workspaceId: current.workspaceId,
              objectId: uploaded.data.objectId,
            },
            body: {
              fileId,
              revisionId,
              mutationId: crypto.randomUUID(),
              deviceId: current.store.deviceId,
              path: `attachments/${fileId}-${safeName}`,
              digest: uploaded.data.digest,
            },
          });
          if (finalized.error !== undefined) {
            setPasteNotice(
              `The image ${file.name} did not finalize: ${problemMessage(finalized.error)}`,
            );
            continue;
          }
          insertAtCursor(`![${safeName}](/attachments/${revisionId})`);
          setPasteNotice('');
        } catch {
          setPasteNotice(
            `The image ${file.name} could not be read on this device.`,
          );
        }
      }
    })();
  };

  const handleDelete = (): void => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    void (async (): Promise<void> => {
      const current = live.current;
      sequenceRef.current += 1;
      try {
        await current.store.checkpoint(
          { ...buildDraft(true), deleted: true },
          null,
        );
        await refreshQueue.current();
      } catch (failure: unknown) {
        setStorageError(
          isLocalStorageError(failure) ? failure.kind : 'aborted',
        );
      }
    })();
  };

  return (
    <div>
      <div>
        <label className="notes-label" htmlFor={`notes-path-${fileId}`}>
          File path
        </label>
        <input
          id={`notes-path-${fileId}`}
          className="notes-input"
          type="text"
          value={path}
          disabled={readOnly}
          onChange={(event): void => {
            const next = event.target.value;
            setPath(next);
            pathRef.current = next;
            if (!live.current.readOnly) {
              sequenceRef.current += 1;
              setDraftPending(true);
              if (saveTimerRef.current !== null)
                window.clearTimeout(saveTimerRef.current);
              saveTimerRef.current = window.setTimeout(() => {
                saveTimerRef.current = null;
                void saveDraftNow.current();
              }, draftSaveDelayMs);
              schedulerRef.current?.onInput();
            }
          }}
        />
      </div>
      <div
        ref={containerRef}
        role="textbox"
        aria-label={`Note ${path}`}
        aria-readonly={readOnly}
        tabIndex={-1}
        onPaste={(event): void => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.some((file) => file.type.startsWith('image/'))) {
            event.preventDefault();
            uploadPastedFiles(files);
          }
        }}
        onDrop={(event): void => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.some((file) => file.type.startsWith('image/'))) {
            event.preventDefault();
            uploadPastedFiles(files);
          }
        }}
      />
      {pasteNotice !== '' ? <StatusRegion message={pasteNotice} /> : null}
      {!readOnly ? (
        <div>
          <Button
            variant="primary"
            label="Save a checkpoint now"
            onClick={() => {
              void (async (): Promise<void> => {
                if (saveTimerRef.current !== null) {
                  window.clearTimeout(saveTimerRef.current);
                  saveTimerRef.current = null;
                }
                await saveDraftNow.current();
                schedulerRef.current?.onSave();
              })();
            }}
          >
            Save
          </Button>
          <Button
            variant="danger"
            label={
              confirmingDelete
                ? 'Confirm deletion of this note'
                : 'Delete this note'
            }
            onClick={handleDelete}
          >
            {confirmingDelete ? 'Confirm delete' : 'Delete'}
          </Button>
          {confirmingDelete ? (
            <Button
              variant="secondary"
              label="Keep this note"
              onClick={() => {
                setConfirmingDelete(false);
              }}
            >
              Keep
            </Button>
          ) : null}
        </div>
      ) : (
        <p>This workspace is read-only for viewers.</p>
      )}
      <SaveStatus
        state={saveState}
        bufferText={bufferText}
        onCopyBuffer={copyToClipboard}
      />
    </div>
  );
}

/** The loading states of one note before its editor mounts. */
type LoaderStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'purged' }
  | { readonly kind: 'unavailable'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly path: string;
      readonly text: string;
      readonly headRevisionId: string | null;
    };

/**
 * Loads one note and mounts its editor.
 *
 * Unknown, purged, and unavailable notes stay distinct and never render as
 * an empty note. The accepted head text comes from the generated `getFile`
 * operation; local drafts and checkpoints take over once the editor mounts.
 */
export function NoteEditorLoader({
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
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<LoaderStatus>({ kind: 'loading' });
  const [linkNotice, setLinkNotice] = useState('');

  useEffect(() => {
    const fresh = readFreshState(location.state, fileId);
    if (fresh !== null) {
      setStatus({
        kind: 'ready',
        path: fresh.initialPath,
        text: fresh.initialText,
        headRevisionId: null,
      });
      return;
    }
    let cancelled = false;
    async function load(): Promise<void> {
      setStatus({ kind: 'loading' });
      const result = await getFile({
        path: { workspaceId, fileId },
      });
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        const code = result.response?.status ?? 0;
        if (code === 404) setStatus({ kind: 'unknown' });
        else if (code === 410) setStatus({ kind: 'purged' });
        else
          setStatus({
            kind: 'unavailable',
            message: problemMessage(result.error),
          });
        return;
      }
      setStatus({
        kind: 'ready',
        path: result.data.path,
        text: result.data.head?.text ?? '',
        headRevisionId: result.data.headRevisionId,
      });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, fileId, location.state]);

  if (status.kind === 'loading')
    return (
      <main>
        <StatusRegion message="Loading the note." />
      </main>
    );
  if (status.kind === 'unknown')
    return (
      <main>
        <h1>Note not found</h1>
        <p>
          The server knows no file with that ID in this workspace. It may be
          removed, or the address may be wrong. This is not an empty note.
        </p>
        <p>
          <Link to={`/w/${workspaceId}`}>Back to the workspace.</Link>
        </p>
      </main>
    );
  if (status.kind === 'purged')
    return (
      <main>
        <h1>Note permanently deleted</h1>
        <p>
          This file was purged by the workspace owner. Pending offline work for
          it stays on this device for recovery into a new file.
        </p>
      </main>
    );
  if (status.kind === 'unavailable')
    return (
      <main>
        <h1>Note unavailable</h1>
        <p className="notes-status-error" role="alert">
          {status.message}
        </p>
      </main>
    );
  if (store === null)
    return (
      <main>
        <h1>{status.path}</h1>
        <p className="notes-status-error" role="alert">
          Local storage is unavailable, so offline editing is closed. The
          accepted server text follows read-only.
        </p>
        <pre>{status.text}</pre>
      </main>
    );

  const writable = role !== null && canWrite(role);
  return (
    <main>
      <h1>{status.path}</h1>
      {linkNotice !== '' ? <StatusRegion message={linkNotice} /> : null}
      <NoteEditor
        key={fileId}
        store={store}
        accountId={accountId}
        workspaceId={workspaceId}
        fileId={fileId}
        baseRevisionId={status.headRevisionId}
        initialText={status.text}
        initialPath={status.path}
        readOnly={!writable}
        onOpenLink={(target: LinkTarget): void => {
          if (target.kind === 'url' && target.target.startsWith('/notes/')) {
            const noteId =
              target.target.slice('/notes/'.length).split('/')[0] ?? '';
            if (noteId !== '') {
              void navigate(`/w/${workspaceId}/notes/${noteId}`);
              return;
            }
          }
          if (target.kind === 'wiki')
            setLinkNotice(
              `Note link [[${target.title}]] resolves in a later task.`,
            );
          else setLinkNotice('That link target opens in a later task.');
        }}
      />
    </main>
  );
}

/**
 * Creates a new note file and opens it.
 *
 * The file starts as a local draft through the store, then the router opens
 * the editor with the handoff state. The first checkpoint submits the
 * creation; until then the file lives only on this device.
 */
export function NewNoteButton({
  store,
  accountId,
  workspaceId,
  disabled,
}: {
  readonly store: LocalStore | null;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly disabled?: boolean | undefined;
}): ReactNode {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Button
        variant="primary"
        label="Create a new note"
        disabled={disabled ?? store === null}
        onClick={() => {
          void (async (): Promise<void> => {
            if (store === null) {
              setError('Local storage is unavailable.');
              return;
            }
            const fileId = crypto.randomUUID();
            const workingCopyId = crypto.randomUUID();
            const draft: Draft = {
              accountId,
              workspaceId,
              workingCopyId,
              fileId,
              baseRevisionId: null,
              text: '',
              path: 'untitled.md',
              deleted: false,
              sequence: 1,
            };
            try {
              await store.saveDraft(draft);
            } catch (failure: unknown) {
              setError(
                isLocalStorageError(failure)
                  ? `The note could not be created on this device (${failure.kind}).`
                  : 'The note could not be created on this device.',
              );
              return;
            }
            setError(null);
            await navigate(`/w/${workspaceId}/notes/${fileId}`, {
              state: {
                fresh: true,
                fileId,
                initialText: '',
                initialPath: 'untitled.md',
              },
            });
          })();
        }}
      >
        New note
      </Button>
      {error !== null ? (
        <p className="notes-status-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
