/**
 * The one-pane note editor screen.
 *
 * One mounted `NoteEditor` owns exactly one CodeMirror view and one working
 * copy. Editor changes flow into `LocalStore.saveDraft` within about 120 ms.
 * Only an explicit Save creates an immutable revision and sends it to the
 * server. The React tree may rerender and the theme may change as often as it
 * wants. Neither action replaces the editor document, so undo history, IME
 * composition, selection, and clipboard content survive them.
 *
 * File identity follows the local-first rule. Edits and renames are drafts.
 * Save and Delete create versions that the foreground sync engine submits.
 * This screen never calls `fetch` and never builds a request URL by hand.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  finalizeAttachment,
  getFile,
  uploadAttachment,
} from '@notesapp/api-client';
import { generateUUID } from '@notesapp/core';
import {
  isLocalStorageError,
  saveCheckpointMessage,
  type Draft,
  type FileSaveSnapshot,
  type LocalStore,
  type LocalStorageErrorKind,
  type QueueEntry,
} from '@notesapp/sync';
import {
  createEditor,
  setEditorRich,
  setEditorTheme,
  setNoteLinkSource,
  type EditorView,
  type LinkTarget,
  type RichWidgetResolvers,
} from '@notesapp/editor';
import type { RenderMarkdownOptions } from '@notesapp/markdown';
import { Button, CollapsibleSection, Notice, StatusRegion } from '@notesapp/ui';
import { problemMessage, useTheme } from '../app.tsx';
import { createAttachmentLoader } from './attachment-content.ts';
import { activeNoteChanged, setActiveNoteView } from './active-note.ts';
import { downloadNote } from './export.ts';
import { useFiles } from './files.tsx';
import { useRegisterNoteActions } from './note-actions.tsx';
import { NoteFooter } from './note-footer.tsx';
import { NoteHeader } from './note-header.tsx';
import { missingNoteNotice, resolveLinkAction } from './note-link.ts';
import {
  cleanNoteName,
  displayNoteName,
  duplicateNameProblem,
  noteNameProblem,
  storageNotePath,
} from './note-name.ts';
import { OutlinePanel } from './outline.tsx';
import { resolveSaveButton } from './save-state.ts';
import { useDeleteNotice } from './trash.tsx';
import { createDiagramFrame } from '../diagram/frame.ts';
import {
  resolveSaveState,
  useBlockUnsafeReload,
  usePublishNoteSave,
  type SaveState,
} from './save-status.tsx';

/** Draft writes trail input by this long, inside the 150 ms target. */
const draftSaveDelayMs = 120;

/** The accepted head that a stale draft of this device does not contain. */
export type StaleHead = {
  readonly revisionId: string | null;
  readonly path: string;
  readonly text: string;
};

/** The bar copy, named so the screen and its tests state it once. */
export const staleDraftNotice =
  'This device has unsaved text from an older version of this note.';

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

/** The revision IDs referenced by one Markdown source, without duplicates. */
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

/** Safety refresh when browser invalidation messages are unavailable. */
const saveStateFallbackMs = 30_000;

/** The two surfaces of one note: the source editor and the rendered text. */
type NoteMode = 'write' | 'read';

/** What one attachment upload is doing right now. */
type AttachState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'uploading'; readonly name: string }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Typography of the rendered note.
 *
 * Read mode shows the same document as the editor, so it uses the same
 * measure, the same font, and the same semantic colour tokens. The rendered
 * HTML comes from the shared renderer, so its elements are reached with
 * Tailwind element variants instead of a style sheet.
 */
const readTypography = [
  'mx-auto max-w-3xl px-4 py-4 font-sans text-ui text-ink',
  '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-strong',
  '[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-strong',
  '[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-strong',
  '[&_h4]:mb-2 [&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-strong',
  '[&_h5]:mb-2 [&_h5]:mt-4 [&_h5]:font-semibold [&_h5]:text-strong',
  '[&_h6]:mb-2 [&_h6]:mt-4 [&_h6]:font-semibold [&_h6]:text-strong',
  '[&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3 [&_ul]:list-disc [&_ol]:list-decimal',
  '[&_ul]:pl-6 [&_ol]:pl-6 [&_li]:my-1',
  '[&_a]:text-accent [&_a]:underline',
  '[&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_code]:font-mono',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-card',
  '[&_pre]:p-3 [&_pre]:font-mono [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-edge',
  '[&_blockquote]:pl-3 [&_blockquote]:text-muted',
  '[&_hr]:my-6 [&_hr]:border-edge-subtle',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-edge-subtle [&_th]:px-2 [&_th]:py-1',
  '[&_td]:border [&_td]:border-edge-subtle [&_td]:px-2 [&_td]:py-1',
  '[&_th]:text-strong [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg',
  '[&_input]:mr-2',
].join(' ');

/** Props of the editing surface. `initialText` is read once at mount. */
export type NoteEditorProps = {
  readonly store: LocalStore;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly fileId: string;
  readonly baseRevisionId: string | null;
  readonly initialText: string;
  readonly initialPath: string;
  /**
   * The accepted head this device did not see, when the opened text is a
   * draft written over an older version. The editor then asks the person to
   * choose instead of showing stale text as if it were current.
   */
  readonly staleHead?: StaleHead | undefined;
  readonly initialWorkingCopyId?: string | undefined;
  readonly initialSequence?: number | undefined;
  readonly focusName?: boolean | undefined;
  readonly onOpenLink?: ((target: LinkTarget) => void) | undefined;
  readonly onQueued?: ((entry: QueueEntry | null) => void) | undefined;
  /** Opens the Move to folder dialog that the note screen owns. */
  readonly onMoveToFolder?: (() => void) | undefined;
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
  staleHead,
  initialWorkingCopyId,
  initialSequence = 0,
  focusName = false,
  onOpenLink,
  onQueued,
  onMoveToFolder,
}: NoteEditorProps): ReactNode {
  const navigate = useNavigate();
  const noteList = useFiles();
  const { announce: announceDeleted } = useDeleteNotice();
  const isDeletedRef = useRef(false);
  const { resolved } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const bufferRef = useRef(initialText);
  const pathRef = useRef(initialPath);
  // A name that breaks a rule is never written. The draft, the tree, and
  // the server keep the last valid name until the person fixes the field.
  const validPathRef = useRef(initialPath);
  const sequenceRef = useRef(initialSequence);
  const [name, setName] = useState(displayNoteName(initialPath));
  const [pathError, setPathError] = useState('');
  const [bufferText, setBufferText] = useState(initialText);
  const [draftPending, setDraftPending] = useState(false);
  const [saveSnapshot, setSaveSnapshot] = useState<FileSaveSnapshot | null>(
    null,
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [storageError, setStorageError] =
    useState<LocalStorageErrorKind | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [pasteNotice, setPasteNotice] = useState('');
  const [mode, setMode] = useState<NoteMode>('write');
  const [readError, setReadError] = useState('');
  const [attachState, setAttachState] = useState<AttachState>({ kind: 'idle' });
  const readRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastFilesRef = useRef<readonly File[]>([]);
  const renderMarkdownRef = useRef<
    | ((source: string, options?: RenderMarkdownOptions) => Promise<string>)
    | null
  >(null);
  const [attachmentUrls, setAttachmentUrls] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const attachmentUrlsRef = useRef<ReadonlyMap<string, string>>(new Map());
  attachmentUrlsRef.current = attachmentUrls;
  const [mathReady, setMathReady] = useState(false);
  // The bar closes for the accepted head the person answered for. A later
  // accepted head is a new question, so the bar opens again by itself.
  const [answeredHead, setAnsweredHead] = useState<string | null | undefined>(
    undefined,
  );
  const [staleNotice, setStaleNotice] = useState('');
  const staleOpen =
    staleHead !== undefined && answeredHead !== staleHead.revisionId;
  // The base only moves when the person keeps a stale draft or takes the
  // accepted head. Until then the opened base is the one the loader read.
  const [baseOverride, setBaseOverride] = useState<string | null | undefined>(
    undefined,
  );
  const openedBase = baseOverride === undefined ? baseRevisionId : baseOverride;
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
  const loader = useMemo(
    () => createAttachmentLoader(workspaceId),
    [workspaceId],
  );

  useEffect(() => {
    if (!focusName) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [focusName]);

  const live = useRef({
    store,
    accountId,
    workspaceId,
    fileId,
    baseRevisionId: openedBase,
    workingCopyId,
  });
  live.current = {
    store,
    accountId,
    workspaceId,
    fileId,
    baseRevisionId: openedBase,
    workingCopyId,
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
      path: validPathRef.current,
      deleted,
      sequence: sequenceRef.current,
    };
  };

  /** Re-reads the queue so the status reports pending and accepted saves. */
  const refreshQueue = useRef((): Promise<void> => Promise.resolve());
  refreshQueue.current = async (): Promise<void> => {
    const current = live.current;
    try {
      const [snapshot, checkpoints] = await Promise.all([
        current.store.readFileSaveSnapshot(
          current.accountId,
          current.workspaceId,
          current.fileId,
        ),
        current.store.listCheckpoints(
          current.accountId,
          current.workspaceId,
          current.fileId,
        ),
      ]);
      setSaveSnapshot(snapshot);
      const latest = checkpoints
        .filter((entry) => !entry.deleted)
        .map((entry) => entry.clientTime)
        .sort()
        .at(-1);
      setLastSavedAt(latest ?? null);
    } catch {
      // Queue reads are feedback only. A failure here must not disturb the
      // buffer, the draft, or the draft timer.
    }
  };

  /** Writes the current buffer as the working draft. */
  const saveDraftNow = useRef((_deleted?: boolean): Promise<boolean> =>
    Promise.resolve(true),
  );
  saveDraftNow.current = async (deleted = false): Promise<boolean> => {
    const isDeleting = deleted || isDeletedRef.current;
    const current = live.current;
    const savedSequence = sequenceRef.current;
    setDraftPending(true);
    const startedAt = performance.now();
    try {
      await current.store.saveDraft(buildDraft(isDeleting));
      recordTiming('notesapp.local-draft-save', startedAt);
      // A newer keystroke may have arrived while the write ran; only that
      // newer write clears the pending flag.
      if (sequenceRef.current === savedSequence) setDraftPending(false);
      setStorageError(null);
      await refreshQueue.current();
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
    const isDeleting = deleted || isDeletedRef.current;
    if (!isDeleting) {
      const error = nameProblemRef.current();
      setPathError(error ?? '');
      if (error !== null) return Promise.resolve();
    }
    const existing = checkpointInFlightRef.current;
    if (existing !== null)
      return isDeleting
        ? existing.then(() => checkpointNow.current(true))
        : existing;
    const run = (async (): Promise<void> => {
      const saved = await saveDraftNow.current(isDeleting);
      if (!saved) return;
      const current = live.current;
      try {
        const entry = await current.store.checkpoint(
          buildDraft(isDeleting),
          saveCheckpointMessage,
        );
        // The new checkpoint is the parent of the next one. Holding it here
        // keeps the editor right even when its draft row is removed, so a
        // later save never names a parent the file already passed.
        const created = entry?.input.revisions[0]?.id;
        if (created !== undefined) setBaseOverride(created);
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

  useEffect(() => {
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
    };
  }, [workingCopyId]);

  // KaTeX and its stylesheet load after the first paint. The rich
  // compartment refreshes without changing the editor document, selection,
  // or undo history.
  useEffect(() => {
    let cancelled = false;
    void import('./markdown.ts').then((module) => {
      if (cancelled) return;
      mathRenderRef.current = module.renderMath;
      renderMarkdownRef.current = module.renderMarkdown;
      setMathReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Attachment widgets use authenticated object URLs. URLs are revoked when
  // their references leave the note and when the editor closes.
  useEffect(() => {
    const wanted = extractAttachmentIds(bufferText);
    const owned = ownedUrlsRef.current;
    for (const [id, entry] of owned) {
      if (!wanted.includes(id)) {
        entry.dispose();
        owned.delete(id);
      }
    }
    if (wanted.every((id) => owned.has(id))) {
      setAttachmentUrls((current) =>
        sameUrls(current, owned)
          ? current
          : new Map([...owned].map(([id, entry]) => [id, entry.url] as const)),
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
          // A missing attachment stays as editable source in its widget.
        }
      }
      if (!cancelled)
        setAttachmentUrls((current) =>
          sameUrls(current, owned)
            ? current
            : new Map(
                [...owned].map(([id, entry]) => [id, entry.url] as const),
              ),
        );
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loader, bufferText]);

  useEffect(
    () => () => {
      for (const entry of ownedUrlsRef.current.values()) entry.dispose();
      ownedUrlsRef.current.clear();
    },
    [],
  );

  // The resolvers keep their identity between keystrokes. They are rebuilt
  // only when math arrives, when the palette changes, or when the set of
  // resolved attachment URLs really changed, because a new object here
  // reconfigures the widget compartment (MD-10).
  const richResolvers = useMemo<RichWidgetResolvers>(
    () => ({
      renderMath: !mathReady
        ? undefined
        : (source: string, display: boolean): string => {
            const render = mathRenderRef.current;
            if (render === null) throw new Error('Math is still loading.');
            return render(source, display);
          },
      resolveAttachment: (revisionId: string): string | null =>
        attachmentUrlsRef.current.get(revisionId) ?? null,
      createDiagram: (source: string): HTMLElement =>
        createDiagramFrame({
          source,
          theme: themeRef.current,
          framePath: diagramFramePath,
        }).element,
    }),
    [attachmentUrls, mathReady, resolved],
  );

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
        activeNoteChanged();
        sequenceRef.current += 1;
        setDraftPending(true);
        if (saveTimerRef.current !== null)
          window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          void saveDraftNow.current();
        }, draftSaveDelayMs);
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
        theme: themeRef.current,
        rich: richResolvers,
      },
    );
    viewRef.current = view;
    setActiveNoteView(view);
    return () => {
      viewRef.current = null;
      setActiveNoteView(null);
      view.destroy();
    };
  }, [workingCopyId]);

  // Theme changes reconfigure one compartment, keeping document, undo,
  // selection, and composition exactly where they are.
  useEffect(() => {
    const view = viewRef.current;
    if (view !== null) setEditorTheme(view, resolved);
  }, [resolved]);

  // The note list feeds the link completion. It travels through one
  // compartment, so a refreshed list never replaces the document.
  useEffect(() => {
    let cancelled = false;
    const publish = async (): Promise<void> => {
      try {
        const files = await store.listLocalFiles(accountId, workspaceId);
        const view = viewRef.current;
        if (cancelled || view === null) return;
        setNoteLinkSource(view, {
          currentPath: pathRef.current,
          notes: files
            .filter((file) => file.kind === 'note' && !file.deleted)
            .map((file) => ({ path: file.path })),
        });
      } catch {
        // Completion is an aid. Without the list the person still types a
        // link by hand, so a failed read changes nothing else.
      }
    };
    void publish();
    const unsubscribe = store.subscribe((change) => {
      if (change.accountId === accountId && change.workspaceId === workspaceId)
        void publish();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [store, accountId, workspaceId, workingCopyId]);

  // Read mode renders the current buffer with the shared renderer. The
  // editor stays mounted and keeps its document, so the switch back is free.
  useEffect(() => {
    if (mode !== 'read') return;
    const host = readRef.current;
    const render = renderMarkdownRef.current;
    if (host === null || render === null) return;
    let cancelled = false;
    const disposers: Array<() => void> = [];
    void (async (): Promise<void> => {
      try {
        const html = await render(bufferText, {
          attachmentHref: (revisionId: string): string =>
            attachmentUrls.get(revisionId) ?? '',
        });
        if (cancelled) return;
        host.innerHTML = html;
        setReadError('');
        // Mermaid keeps its isolated frame here too, so Read mode never runs
        // a diagram library inside the application origin.
        for (const block of host.querySelectorAll('pre[data-diagram]')) {
          const frame = createDiagramFrame({
            source: block.textContent ?? '',
            theme: themeRef.current,
            framePath: diagramFramePath,
          });
          disposers.push(frame.dispose);
          block.replaceWith(frame.element);
        }
      } catch {
        if (cancelled) return;
        host.textContent = '';
        setReadError(
          'This note is too large or too deeply nested to show as text. Switch to Write to read the source.',
        );
      }
    })();
    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
    };
  }, [mode, bufferText, attachmentUrls, mathReady, resolved]);

  // Save and the Read switch are window level, so they work while focus sits
  // in the note name field. CodeMirror marks the event handled first, so the
  // editor binding never fires twice.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (!event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        void checkpointNow.current();
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setMode((current) => (current === 'write' ? 'read' : 'write'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // The editor measures itself again when it becomes visible, so the
  // scroller keeps the right height after a switch back to Write. The first
  // render is not a switch, so it never takes focus from the name field.
  const previousModeRef = useRef<NoteMode>(mode);
  useEffect(() => {
    const changed = previousModeRef.current !== mode;
    previousModeRef.current = mode;
    if (!changed || mode !== 'write') return;
    const view = viewRef.current;
    if (view === null) return;
    view.requestMeasure();
    view.focus();
  }, [mode]);

  /** Switches Write and Read, for the header toggle and the palette. */
  const toggleMode = useCallback((): void => {
    setMode((current) => (current === 'write' ? 'read' : 'write'));
  }, []);

  const saveState: SaveState = resolveSaveState({
    draftWritePending: draftPending,
    queueState: saveSnapshot?.queueState ?? null,
    storageError,
    hasUncheckpointedDraft: saveSnapshot?.hasUncheckpointedDraft ?? true,
    acceptedHeadRevisionId: saveSnapshot?.acceptedHeadRevisionId ?? null,
    localHeadRevisionId: saveSnapshot?.localHeadRevisionId ?? null,
  });
  // The buffer is the only copy until the draft commits, and it is the only
  // copy again when storage fails. Both cases block an unsafe reload. A
  // queued save is durable on this device, so it never blocks one.
  useBlockUnsafeReload(draftPending || storageError !== null);
  const hasUnsavedEdits =
    draftPending || (saveSnapshot?.hasUncheckpointedDraft ?? false);
  const saveButton = resolveSaveButton({
    state: saveState,
    hasUnsavedEdits,
  });
  usePublishNoteSave({
    state: saveState,
    hasUnsavedEdits,
    lastSavedAt,
  });
  useRegisterNoteActions({ fileId, toggleReadMode: toggleMode });

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
    if (images.length === 0) return;
    lastFilesRef.current = images;
    void (async (): Promise<void> => {
      const current = live.current;
      for (const file of images) {
        setAttachState({ kind: 'uploading', name: file.name });
        if (file.size > maxPastedBytes) {
          setAttachState({
            kind: 'failed',
            message: `The image ${file.name} is larger than 20 MiB and was not uploaded.`,
          });
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
            const message = `The image ${file.name} did not upload: ${problemMessage(uploaded.error)}`;
            setAttachState({ kind: 'failed', message });
            setPasteNotice(message);
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
            const message = `The image ${file.name} did not finalize: ${problemMessage(finalized.error)}`;
            setAttachState({ kind: 'failed', message });
            setPasteNotice(message);
            continue;
          }
          insertAtCursor(`![${safeName}](/attachments/${revisionId})`);
          setAttachState({ kind: 'idle' });
          setPasteNotice('');
        } catch {
          const message = `The image ${file.name} could not be read on this device.`;
          setAttachState({ kind: 'failed', message });
          setPasteNotice(message);
        }
      }
    })();
  };

  /**
   * Keeps the draft of this device and moves its base to the accepted head.
   *
   * The text does not change. Only the parent that the next checkpoint names
   * moves, so the following Save reaches the server instead of naming a head
   * the server replaced.
   */
  const keepStaleDraft = (): void => {
    const current = live.current;
    void (async (): Promise<void> => {
      try {
        await current.store.rebaseDraft(
          current.accountId,
          current.workspaceId,
          current.workingCopyId,
        );
        setBaseOverride(staleHead?.revisionId ?? null);
        setAnsweredHead(staleHead?.revisionId ?? null);
        setStaleNotice('Your text is kept. Save sends it to the server.');
        setStorageError(null);
      } catch (failure: unknown) {
        setStorageError(
          isLocalStorageError(failure) ? failure.kind : 'aborted',
        );
      }
    })();
  };

  /**
   * Takes the accepted head and keeps the draft text as a kept copy.
   *
   * The old text goes to the account-bound recovery area first, so the choice
   * is reversible, and only then does the document change. Replacing the
   * document is a user action here, never a render or a theme change.
   */
  const useAcceptedHead = (): void => {
    const head = staleHead;
    if (head === undefined) return;
    const current = live.current;
    void (async (): Promise<void> => {
      try {
        await current.store.addRecovery(
          current.accountId,
          current.workspaceId,
          {
            fileId: current.fileId,
            path: pathRef.current,
            text: bufferRef.current,
            reason: 'stale_draft',
          },
        );
        await current.store.rebaseDraft(
          current.accountId,
          current.workspaceId,
          current.workingCopyId,
        );
        setBaseOverride(head.revisionId);
        const view = viewRef.current;
        if (view !== null)
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: head.text },
          });
        bufferRef.current = head.text;
        setBufferText(head.text);
        pathRef.current = head.path;
        setName(displayNoteName(head.path));
        setAnsweredHead(head.revisionId);
        setStaleNotice(
          'The latest version is open. Your older text waits under Needs attention.',
        );
        setStorageError(null);
      } catch (failure: unknown) {
        setStorageError(
          isLocalStorageError(failure) ? failure.kind : 'aborted',
        );
      }
    })();
  };

  /** The one reason the typed name cannot be saved, or `null`. */
  const nameProblemRef = useRef((): string | null => null);
  nameProblemRef.current = (): string | null => {
    const cleaned = cleanNoteName(displayNoteName(pathRef.current));
    const problem = noteNameProblem(cleaned);
    if (problem !== null) return problem;
    return duplicateNameProblem(
      storageNotePath(cleaned),
      noteList.notes,
      fileId,
    );
  };

  /** Reports the typed name and applies it when every rule holds. */
  const applyName = (nextName: string): void => {
    setName(nextName);
    pathRef.current = storageNotePath(cleanNoteName(nextName));
    const problem = nameProblemRef.current();
    setPathError(problem ?? '');
    if (problem !== null) return;
    validPathRef.current = pathRef.current;
    sequenceRef.current += 1;
    setDraftPending(true);
    if (saveTimerRef.current !== null)
      window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveDraftNow.current();
    }, draftSaveDelayMs);
  };

  /**
   * Writes the typed name into the field in its stored form.
   *
   * Edge spaces go, and a typed `.md` suffix disappears, so one note never
   * carries two names on screen. This runs when the field loses focus and
   * when the person presses Enter.
   */
  const commitName = (): void => {
    const cleaned = cleanNoteName(name);
    if (cleaned !== name) applyName(cleaned);
    else setPathError(nameProblemRef.current() ?? '');
  };

  /** Copies the open note into a new note beside it. */
  const duplicateNote = (): void => {
    const current = live.current;
    const base = displayNoteName(validPathRef.current);
    const taken = new Set(
      noteList.notes.map((entry) => entry.path.toLowerCase()),
    );
    let candidate = `${base} copy`;
    let index = 2;
    while (taken.has(storageNotePath(candidate).toLowerCase())) {
      candidate = `${base} copy ${String(index)}`;
      index += 1;
    }
    const copyId = generateUUID();
    const copy: Draft = {
      accountId: current.accountId,
      workspaceId: current.workspaceId,
      workingCopyId: generateUUID(),
      fileId: copyId,
      baseRevisionId: null,
      text: bufferRef.current,
      path: storageNotePath(candidate),
      deleted: false,
      sequence: 1,
    };
    void (async (): Promise<void> => {
      try {
        await current.store.saveDraft(copy);
      } catch (failure: unknown) {
        setStorageError(
          isLocalStorageError(failure) ? failure.kind : 'aborted',
        );
        return;
      }
      void navigate(`/w/${current.workspaceId}/notes/${copyId}`);
    })();
  };

  const handleDelete = (): void => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    isDeletedRef.current = true;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const deletedName = displayNoteName(validPathRef.current);
    void (async (): Promise<void> => {
      sequenceRef.current += 1;
      try {
        await checkpointNow.current(true);
        // The note is in the trash now, so the person leaves for the note
        // list and the notice there offers one step back.
        announceDeleted({ workspaceId, fileId, name: deletedName });
        void navigate(`/w/${workspaceId}`);
      } catch (failure: unknown) {
        isDeletedRef.current = false;
        setStorageError(
          isLocalStorageError(failure) ? failure.kind : 'aborted',
        );
      }
    })();
  };

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      data-save-state={saveState}
    >
      <NoteHeader
        fileId={fileId}
        name={name}
        nameError={pathError}
        nameInputRef={nameInputRef}
        onNameChange={applyName}
        onNameCommit={commitName}
        saveButton={saveButton}
        onSave={() => {
          void (async (): Promise<void> => {
            if (saveTimerRef.current !== null) {
              window.clearTimeout(saveTimerRef.current);
              saveTimerRef.current = null;
            }
            await checkpointNow.current();
          })();
        }}
        readToggle={
          <div className="inline-flex rounded-lg border border-edge p-0.5">
            <button
              type="button"
              aria-pressed={mode === 'write'}
              title="Write (Cmd or Ctrl + Shift + P)"
              className={`min-h-11 cursor-pointer rounded-md border-0 px-3 text-control font-medium motion-safe:transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-8 ${
                mode === 'write'
                  ? 'bg-accent-fill text-on-accent'
                  : 'bg-transparent text-strong hover:bg-hover'
              }`}
              onClick={() => {
                setMode('write');
              }}
            >
              Write
            </button>
            <button
              type="button"
              aria-pressed={mode === 'read'}
              title="Read (Cmd or Ctrl + Shift + P)"
              className={`min-h-11 cursor-pointer rounded-md border-0 px-3 text-control font-medium motion-safe:transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-8 ${
                mode === 'read'
                  ? 'bg-accent-fill text-on-accent'
                  : 'bg-transparent text-strong hover:bg-hover'
              }`}
              onClick={() => {
                setMode('read');
              }}
            >
              Read
            </button>
          </div>
        }
        confirmingDelete={confirmingDelete}
        onCancelDelete={() => setConfirmingDelete(false)}
        handlers={{
          onHistory: () => {
            void navigate(`/w/${workspaceId}/notes/${fileId}/history`);
          },
          onMoveToFolder: () => onMoveToFolder?.(),
          onDuplicate: duplicateNote,
          onDelete: handleDelete,
          onAttachImage: () => {
            fileInputRef.current?.click();
          },
          onExport: () => {
            void downloadNote(workspaceId, fileId).catch((failure: unknown) => {
              setPasteNotice(
                failure instanceof Error
                  ? failure.message
                  : 'The note could not be saved as a file.',
              );
            });
          },
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col px-4 sm:px-6">
        {staleOpen && staleHead !== undefined ? (
          <section
            className="mt-4 rounded-lg border border-edge bg-card p-3"
            aria-labelledby={`notes-stale-${fileId}`}
          >
            <p
              className="m-0 text-ui font-medium text-strong"
              id={`notes-stale-${fileId}`}
              role="alert"
            >
              {staleDraftNotice}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" onClick={keepStaleDraft}>
                Keep my text
              </Button>
              <Button variant="secondary" size="sm" onClick={useAcceptedHead}>
                Use the latest version
              </Button>
            </div>
          </section>
        ) : null}
        {staleNotice === '' ? null : (
          <div className="mt-4">
            <Notice tone="info" message={staleNotice} />
          </div>
        )}
        {pasteNotice === '' ? null : (
          <div className="mt-4">
            <Notice tone="problem" message={pasteNotice} />
          </div>
        )}
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          multiple
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event): void => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = '';
            uploadPastedFiles(chosen);
          }}
        />
        {attachState.kind === 'uploading' ? (
          <p className="m-0 mt-4 text-control text-muted" role="status">
            {`Uploading ${attachState.name}.`}
          </p>
        ) : null}
        {attachState.kind === 'failed' ? (
          <div className="mt-4">
            <Notice tone="problem" message={attachState.message}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  uploadPastedFiles(lastFilesRef.current);
                }}
              >
                Try again
              </Button>
            </Notice>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 gap-6 py-4">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              ref={containerRef}
              className={`min-h-0 flex-1 overflow-hidden ${mode === 'read' ? 'hidden' : ''}`}
              onPaste={(event): void => {
                const dropped = Array.from(event.clipboardData?.files ?? []);
                if (dropped.some((file) => file.type.startsWith('image/'))) {
                  event.preventDefault();
                  uploadPastedFiles(dropped);
                }
              }}
              onDrop={(event): void => {
                const dropped = Array.from(event.dataTransfer?.files ?? []);
                if (dropped.some((file) => file.type.startsWith('image/'))) {
                  event.preventDefault();
                  uploadPastedFiles(dropped);
                }
              }}
            />
            {mode === 'read' ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <div
                  ref={readRef}
                  data-note-view="read"
                  className={readTypography}
                />
                {readError === '' ? null : (
                  <p className="px-4 text-control text-danger" role="alert">
                    {readError}
                  </p>
                )}
              </div>
            ) : null}
          </div>
          <aside
            className="hidden w-56 shrink-0 overflow-y-auto lg:block"
            aria-label="Note outline"
          >
            <CollapsibleSection
              id="notes-outline"
              title="Outline"
              open={outlineOpen}
              onToggle={setOutlineOpen}
            >
              <OutlinePanel
                workspaceId={workspaceId}
                fileId={fileId}
                text={bufferText}
              />
            </CollapsibleSection>
          </aside>
        </div>
      </div>

      <NoteFooter text={bufferText} lastSavedAt={lastSavedAt} />
    </div>
  );
}

/** Whether the resolved attachment URLs are already the ones we hold. */
function sameUrls(
  current: ReadonlyMap<string, string>,
  owned: ReadonlyMap<string, { url: string }>,
): boolean {
  if (current.size !== owned.size) return false;
  for (const [id, entry] of owned)
    if (current.get(id) !== entry.url) return false;
  return true;
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
      readonly sequence: number;
      /** Set when the opened text is a draft over an older accepted head. */
      readonly staleHead?: StaleHead | undefined;
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
  onMoveToFolder,
}: {
  readonly store: LocalStore | null;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly fileId: string;
  readonly onMoveToFolder?: (() => void) | undefined;
}): ReactNode {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<LoaderStatus>({ kind: 'loading' });
  // A restore brings a deleted note back. The loader then reads the note once
  // more, so the screen leaves the deleted state without a reload.
  const [reloadToken, setReloadToken] = useState(0);
  const statusKind = useRef<LoaderStatus['kind']>(status.kind);
  statusKind.current = status.kind;
  const [linkNotice, setLinkNotice] = useState('');
  const routeState: unknown = location.state;
  const focusName =
    routeState !== null &&
    typeof routeState === 'object' &&
    Object.fromEntries(Object.entries(routeState))['focusNoteName'] === true;

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
              workingCopyId: cached.workingCopyId,
              sequence: cached.sequence,
              staleHead:
                cached.stale && cached.acceptedText !== null
                  ? {
                      revisionId: cached.acceptedRevisionId,
                      path: cached.acceptedPath ?? cached.path,
                      text: cached.acceptedText,
                    }
                  : undefined,
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
        sequence: 0,
      });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [store, accountId, workspaceId, fileId, reloadToken]);

  // A newer accepted head can arrive while the note is open. Only the stale
  // head of the mounted status changes: the editor keeps its instance, its
  // document, its undo history, and its selection.
  useEffect(() => {
    if (store === null) return;
    const activeStore = store;
    let cancelled = false;
    const recheck = async (): Promise<void> => {
      try {
        const cached = await activeStore.readCachedNote(
          accountId,
          workspaceId,
          fileId,
        );
        if (cancelled || cached === null) return;
        // The note was in the trash and is not any more, so a restore
        // reached this device. The loader reads it again.
        if (!cached.deleted && statusKind.current === 'deleted') {
          setReloadToken((token) => token + 1);
          return;
        }
        const next: StaleHead | undefined =
          cached.stale && cached.acceptedText !== null
            ? {
                revisionId: cached.acceptedRevisionId,
                path: cached.acceptedPath ?? cached.path,
                text: cached.acceptedText,
              }
            : undefined;
        setStatus((current) =>
          current.kind !== 'ready' ||
          current.staleHead?.revisionId === next?.revisionId
            ? current
            : { ...current, staleHead: next },
        );
      } catch {
        // The open note keeps its buffer. A failed recheck changes nothing.
      }
    };
    const unsubscribe = activeStore.subscribe((change) => {
      if (
        change.accountId === accountId &&
        change.workspaceId === workspaceId &&
        change.kind === 'file' &&
        (change.fileId === null || change.fileId === fileId)
      )
        void recheck();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [store, accountId, workspaceId, fileId]);

  if (status.kind === 'loading')
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <StatusRegion message="Loading the note." />
      </section>
    );
  if (status.kind === 'unknown')
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Note not found
        </h1>
        <p>
          The server knows no note at that address. It may be removed, or the
          address may be wrong. This is not an empty note.
        </p>
        <p>
          <Link to={`/w/${workspaceId}`}>Back to your notes.</Link>
        </p>
      </section>
    );
  if (status.kind === 'purged')
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Note deleted permanently
        </h1>
        <p>
          This note was deleted permanently. Work for it that waits on this
          device stays here and can go into a new note.
        </p>
        <p>
          <Link to={`/w/${workspaceId}`}>Back to your notes.</Link>
        </p>
      </section>
    );
  if (status.kind === 'deleted')
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Note deleted on this device
        </h1>
        <p>
          {displayNoteName(status.path)} is in the trash. The deletion goes to
          the server when this device has a connection.
        </p>
        <p>
          <Link to={`/w/${workspaceId}/trash`}>Open Trash.</Link>
        </p>
      </section>
    );
  if (status.kind === 'unavailable')
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Note unavailable
        </h1>
        <p className="text-control text-danger" role="alert">
          {status.message}
        </p>
      </section>
    );
  if (store === null)
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          {displayNoteName(status.path)}
        </h1>
        <p className="text-control text-danger" role="alert">
          Local storage is unavailable, so editing is closed here. The saved
          text follows and can be read.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-edge-subtle bg-card p-3 text-control">
          {status.text}
        </pre>
      </section>
    );

  const activeStore = store;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {linkNotice === '' ? null : (
        <div className="px-4 pt-4 sm:px-6">
          <Notice tone="info" message={linkNotice} />
        </div>
      )}
      <NoteEditor
        key={fileId}
        store={store}
        accountId={accountId}
        workspaceId={workspaceId}
        fileId={fileId}
        baseRevisionId={status.headRevisionId}
        initialText={status.text}
        initialPath={status.path}
        staleHead={status.staleHead}
        initialWorkingCopyId={status.workingCopyId}
        initialSequence={status.sequence}
        focusName={focusName}
        onMoveToFolder={onMoveToFolder}
        onOpenLink={(target: LinkTarget): void => {
          const action = resolveLinkAction(target.target);
          if (action.kind === 'note-id') {
            setLinkNotice('');
            void navigate(`/w/${workspaceId}/notes/${action.fileId}`);
            return;
          }
          if (action.kind === 'external') {
            setLinkNotice('');
            window.open(action.url, '_blank', 'noopener,noreferrer');
            return;
          }
          if (action.kind === 'note-name') {
            void (async (): Promise<void> => {
              const wanted = storageNotePath(action.name).toLowerCase();
              const files = await activeStore.listLocalFiles(
                accountId,
                workspaceId,
              );
              const found = files.find(
                (file) =>
                  file.kind === 'note' &&
                  !file.deleted &&
                  file.path.toLowerCase() === wanted,
              );
              if (found === undefined) {
                setLinkNotice(missingNoteNotice);
                return;
              }
              setLinkNotice('');
              void navigate(`/w/${workspaceId}/notes/${found.fileId}`);
            })();
            return;
          }
          setLinkNotice('This link points at nothing that can open here.');
        }}
      />
    </div>
  );
}
