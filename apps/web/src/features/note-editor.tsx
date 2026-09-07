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
import { Link, useNavigate } from 'react-router';
import {
  finalizeAttachment,
  getFile,
  uploadAttachment,
} from '@notesapp/api-client';
import { generateUUID } from '@notesapp/core';
import {
  createCheckpointScheduler,
  isLocalStorageError,
  type CheckpointScheduler,
  type Draft,
  type FileSaveSnapshot,
  type LocalStore,
  type LocalStorageErrorKind,
  type QueueEntry,
} from '@notesapp/sync';
import {
  createEditor,
  setEditorReadOnly,
  setEditorRich,
  setEditorTheme,
  type EditorView,
  type LinkTarget,
  type RichWidgetResolvers,
} from '@notesapp/editor';
import {
  Badge,
  Button,
  CheckIcon,
  StatusRegion,
  TrashIcon,
} from '@notesapp/ui';
import { problemMessage, useTheme } from '../app.tsx';
import { canWrite } from './workspaces.tsx';
import { createAttachmentLoader } from './attachment-content.ts';
import { createDiagramFrame } from '../diagram/frame.ts';
import { copyText } from '../platform.ts';
import { stableNoteLink, type StableLinkRequest } from './search.tsx';
import {
  resolveSaveState,
  SaveStatus,
  useBlockUnsafeReload,
  type SaveState,
} from './save-status.tsx';

/** Draft writes trail input by this long, inside the 150 ms target. */
const draftSaveDelayMs = 120;

/** Records a bounded browser timing entry without affecting the operation. */
function recordTiming(name: string, startedAt: number): void {
  try {
    performance.measure(name, {
      start: startedAt,
      end: performance.now(),
    });
    if (performance.getEntriesByName(name).length > 200)
      performance.clearMeasures(name);
  } catch {
    // User Timing is development evidence only. It cannot break note work.
  }
}

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

/** Safety refresh when browser invalidation messages are unavailable. */
const saveStateFallbackMs = 30_000;

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
  readonly initialWorkingCopyId?: string | undefined;
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
  initialWorkingCopyId,
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
  const [path, setPath] = useState(initialPath);
  const [bufferText, setBufferText] = useState(initialText);
  const [draftPending, setDraftPending] = useState(false);
  const [saveSnapshot, setSaveSnapshot] = useState<FileSaveSnapshot | null>(
    null,
  );
  const [storageError, setStorageError] =
    useState<LocalStorageErrorKind | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pasteNotice, setPasteNotice] = useState('');
  const [attachmentUrls, setAttachmentUrls] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const [mathReady, setMathReady] = useState(false);
  const workingCopyId = useMemo(
    () => initialWorkingCopyId ?? generateUUID(),
    [initialWorkingCopyId],
  );
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
      const snapshot = await current.store.readFileSaveSnapshot(
        current.accountId,
        current.workspaceId,
        current.fileId,
      );
      setSaveSnapshot(snapshot);
    } catch {
      // Queue reads are feedback only. A failure here must not disturb the
      // buffer, the draft, or the checkpoint timers.
    }
  };

  /** Writes the current buffer as the working draft. */
  const saveDraftNow = useRef((): Promise<boolean> => Promise.resolve(true));
  saveDraftNow.current = async (): Promise<boolean> => {
    const current = live.current;
    const savedSequence = sequenceRef.current;
    setDraftPending(true);
    const startedAt = performance.now();
    try {
      await current.store.saveDraft(buildDraft(false));
      recordTiming('notesapp.local-draft-save', startedAt);
      // A newer keystroke may have arrived while the write ran; only that
      // newer write clears the pending flag.
      if (sequenceRef.current === savedSequence) setDraftPending(false);
      setStorageError(null);
      return true;
    } catch (failure: unknown) {
      setDraftPending(false);
      setStorageError(isLocalStorageError(failure) ? failure.kind : 'aborted');
      return false;
    }
  };

  /** Creates one immutable checkpoint from the current buffer. */
  const checkpointInFlightRef = useRef<Promise<void> | null>(null);
  const checkpointNow = useRef((_deleted?: boolean): Promise<void> =>
    Promise.resolve(),
  );
  checkpointNow.current = (deleted = false): Promise<void> => {
    const existing = checkpointInFlightRef.current;
    if (existing !== null)
      return deleted
        ? existing.then(() => checkpointNow.current(true))
        : existing;
    const run = (async (): Promise<void> => {
      const saved = await saveDraftNow.current();
      if (!saved) return;
      const current = live.current;
      try {
        const entry = await current.store.checkpoint(buildDraft(deleted), null);
        callbacks.current.onQueued?.(entry);
        setStorageError(null);
        await refreshQueue.current();
      } catch (failure: unknown) {
        setStorageError(
          isLocalStorageError(failure) ? failure.kind : 'aborted',
        );
      }
    })();
    checkpointInFlightRef.current = run;
    void run.finally(() => {
      if (checkpointInFlightRef.current === run)
        checkpointInFlightRef.current = null;
    });
    return run;
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
    const unsubscribe = live.current.store.subscribe((change) => {
      const current = live.current;
      if (
        change.accountId === current.accountId &&
        change.workspaceId === current.workspaceId &&
        (change.fileId === null || change.fileId === current.fileId)
      )
        void refreshQueue.current();
    });
    const polling = window.setInterval(() => {
      void refreshQueue.current();
    }, saveStateFallbackMs);
    return () => {
      unsubscribe();
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
        const startedAt = performance.now();
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
        recordTiming('notesapp.typing-handler', startedAt);
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
            await checkpointNow.current();
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

  // Workspace access can finish loading after the editor mounts. Reconfigure
  // the existing editor so an owner or editor can type without losing state.
  useEffect(() => {
    const view = viewRef.current;
    if (view !== null) setEditorReadOnly(view, readOnly);
  }, [readOnly]);

  const saveState: SaveState = resolveSaveState({
    draftWritePending: draftPending,
    queueState: saveSnapshot?.queueState ?? null,
    storageError,
    hasUncheckpointedDraft: saveSnapshot?.hasUncheckpointedDraft ?? true,
    acceptedHeadRevisionId: saveSnapshot?.acceptedHeadRevisionId ?? null,
    localHeadRevisionId: saveSnapshot?.localHeadRevisionId ?? null,
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
          const fileId = generateUUID();
          const revisionId = generateUUID();
          const safeName = sanitizeAttachmentName(file.name);
          const finalized = await finalizeAttachment({
            path: {
              workspaceId: current.workspaceId,
              objectId: uploaded.data.objectId,
            },
            body: {
              fileId,
              revisionId,
              mutationId: generateUUID(),
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
      sequenceRef.current += 1;
      try {
        await checkpointNow.current(true);
      } catch (failure: unknown) {
        setStorageError(
          isLocalStorageError(failure) ? failure.kind : 'aborted',
        );
      }
    })();
  };

  return (
    <div className="notes-editor-wrap">
      <div className="notes-doc-header">
        <div className="notes-doc-path-row">
          <input
            id={`notes-path-${fileId}`}
            className="notes-doc-title-input"
            type="text"
            value={path}
            disabled={readOnly}
            aria-label="File path"
            placeholder="File path (e.g. notes/my-note.md)"
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

        <div className="notes-doc-toolbar">
          <SaveStatus
            state={saveState}
            bufferText={bufferText}
            onCopyBuffer={copyText}
          />

          {!readOnly ? (
            <div className="notes-doc-actions">
              <Button
                variant="secondary"
                size="sm"
                icon={<CheckIcon size={14} />}
                label="Save a checkpoint now"
                title="Save checkpoint (Ctrl+S)"
                onClick={() => {
                  void (async (): Promise<void> => {
                    if (saveTimerRef.current !== null) {
                      window.clearTimeout(saveTimerRef.current);
                      saveTimerRef.current = null;
                    }
                    await checkpointNow.current();
                  })();
                }}
              >
                Save
              </Button>
              {confirmingDelete ? (
                <div
                  style={{ display: 'flex', gap: '6px', alignItems: 'center' }}
                >
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<TrashIcon size={14} />}
                    label="Confirm deletion of this note"
                    onClick={handleDelete}
                  >
                    Confirm delete
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    label="Keep this note"
                    onClick={() => {
                      setConfirmingDelete(false);
                    }}
                  >
                    Keep
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<TrashIcon size={14} />}
                  label="Delete this note"
                  title="Delete this note"
                  onClick={handleDelete}
                >
                  Delete
                </Button>
              )}
            </div>
          ) : (
            <Badge variant="default">Read-only</Badge>
          )}
        </div>
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
    </div>
  );
}

/** The loading states of one note before its editor mounts. */
type LoaderStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'purged' }
  | { readonly kind: 'deleted'; readonly path: string }
  | { readonly kind: 'unavailable'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly path: string;
      readonly text: string;
      readonly headRevisionId: string | null;
      readonly workingCopyId?: string | undefined;
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
  const [status, setStatus] = useState<LoaderStatus>({ kind: 'loading' });
  const [linkNotice, setLinkNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setStatus({ kind: 'loading' });
      if (store !== null) {
        try {
          const startedAt = performance.now();
          const cached = await store.readCachedNote(
            accountId,
            workspaceId,
            fileId,
          );
          if (cancelled) return;
          if (cached !== null) {
            recordTiming('notesapp.cached-note-open', startedAt);
            if (cached.deleted) {
              setStatus({ kind: 'deleted', path: cached.path });
              return;
            }
            setStatus({
              kind: 'ready',
              path: cached.path,
              text: cached.text,
              headRevisionId: cached.baseRevisionId,
            });
            return;
          }
        } catch {
          // A server read can still show content. A later local write failure
          // keeps the in-memory buffer visible and closes unsafe reload.
        }
      }
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
  }, [store, accountId, workspaceId, fileId]);

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
  if (status.kind === 'deleted')
    return (
      <main>
        <h1>Note deleted on this device</h1>
        <p>
          {status.path} is deleted locally. The deletion stays queued until this
          device can sync it.
        </p>
        <p>
          <Link to={`/w/${workspaceId}`}>Back to the workspace.</Link>
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
    <div>
      <h1 className="notes-visually-hidden">{status.path}</h1>
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
        initialWorkingCopyId={status.workingCopyId}
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
    </div>
  );
}
