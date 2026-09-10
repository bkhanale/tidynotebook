/**
 * The one save and sync state of the application.
 *
 * The note screen publishes what it knows about the open note through
 * `NoteSaveProvider`. The header reads that, the sync state, the parked
 * saves, and the connection, and shows one quiet chip at every width. The
 * note screen keeps `data-save-state` on its root, so automation reads the
 * note state without reading copy and only one element carries it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import {
  AlertCircleIcon,
  Button,
  CheckIcon,
  CloudCheckIcon,
  CloudOffIcon,
  CloudUploadIcon,
  CopyIcon,
} from '@notesapp/ui';
import { useLocalStore, useSession, useSyncState } from '../app.tsx';
import { attentionTitle, useAttentionCount } from './attention-link.tsx';
import { relativeTime } from './relative-time.ts';
import {
  chipIsProblem,
  chipLabel,
  resolveChipState,
  type ChipState,
  type NoteSaveFacts,
} from './save-state.ts';
import { syncStateMessage } from './sync-state.ts';
export { resolveSaveState } from './save-state.ts';
export type { SaveState, SaveStateInput } from './save-state.ts';

/** What the open note tells the header about itself. */
export type NoteSaveReport = NoteSaveFacts & {
  /** When the last version of this note was created, as an ISO instant. */
  readonly lastSavedAt: string | null;
  /** The in-memory text, offered for the clipboard when a save fails. */
  readonly bufferText: string;
};

type NoteSaveChannel = {
  readonly report: NoteSaveReport | null;
  readonly publish: (report: NoteSaveReport | null) => void;
};

const NoteSaveContext = createContext<NoteSaveChannel>({
  report: null,
  publish: () => {},
});

/**
 * Carries the save facts of the open note up to the header.
 *
 * The note screen sits under the header in the tree, so the shell owns the
 * state and the note screen writes into it. The header then shows one chip
 * for the note the person is looking at.
 */
export function NoteSaveScope({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const [report, setReport] = useState<NoteSaveReport | null>(null);
  const publish = useCallback((next: NoteSaveReport | null): void => {
    setReport(next);
  }, []);
  const value = useMemo<NoteSaveChannel>(
    () => ({ report, publish }),
    [report, publish],
  );
  return (
    <NoteSaveContext.Provider value={value}>
      {children}
    </NoteSaveContext.Provider>
  );
}

/** Reads the save facts of the open note, or `null` on another screen. */
export function useNoteSave(): NoteSaveReport | null {
  return useContext(NoteSaveContext).report;
}

/** Publishes the save facts of the open note while that screen is mounted. */
export function usePublishNoteSave(report: NoteSaveReport): void {
  const { publish } = useContext(NoteSaveContext);
  const { state, hasUnsavedEdits, lastSavedAt, bufferText } = report;
  useEffect(() => {
    publish({ state, hasUnsavedEdits, lastSavedAt, bufferText });
    return () => {
      publish(null);
    };
  }, [publish, state, hasUnsavedEdits, lastSavedAt, bufferText]);
}

/**
 * Blocks an unsafe reload while unsaved work sits only in memory.
 *
 * A queued save is durable on this device and survives a reload, so it
 * never blocks. Only text that has not reached local storage yet, and a
 * local write that failed, keep the browser confirmation.
 */
export function useBlockUnsafeReload(blocked: boolean): void {
  useEffect(() => {
    if (!blocked) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [blocked]);
}

/** Follows the connection state of the browser. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

/** The icon of one chip state. */
function chipIcon(state: ChipState): ReactNode {
  if (state.kind === 'attention') return <AlertCircleIcon size={14} />;
  if (state.kind === 'offline' || state.kind === 'saved-local')
    return <CloudOffIcon size={14} />;
  if (state.kind === 'saving' || state.kind === 'unsaved')
    return <CloudUploadIcon size={14} />;
  return <CloudCheckIcon size={14} />;
}

/**
 * The persistent save and sync chip of the header.
 *
 * It is visible at every width. A press opens a small panel with the time
 * of the last version, one sentence about sync, and the way to the parked
 * saves.
 */
export function SaveStateChip({
  workspaceId,
  onCopyBuffer,
}: {
  readonly workspaceId: string;
  readonly onCopyBuffer?: ((text: string) => Promise<boolean>) | undefined;
}): ReactNode {
  const store = useLocalStore();
  const session = useSession();
  const sync = useSyncState();
  const note = useNoteSave();
  const online = useOnline();
  const attentionCount = useAttentionCount(
    store.store,
    session.account?.accountId ?? null,
    workspaceId,
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const now = Date.now();

  const state = useMemo(
    () =>
      resolveChipState({
        note:
          note === null
            ? null
            : { state: note.state, hasUnsavedEdits: note.hasUnsavedEdits },
        sync: sync.state,
        attentionCount,
        online,
      }),
    [note, sync.state, attentionCount, online],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target) === true)
        return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const label = chipLabel(state);
  const problem = chipIsProblem(state);
  const tone = problem
    ? 'border-danger/40 text-danger'
    : state.kind === 'unsaved'
      ? 'border-edge text-strong'
      : 'border-edge-subtle text-muted';
  const savedAt =
    note?.lastSavedAt === null || note?.lastSavedAt === undefined
      ? null
      : relativeTime(note.lastSavedAt, now);
  const canCopy =
    onCopyBuffer !== undefined &&
    note !== null &&
    (note.state === 'save-failed' || note.state === 'storage-full');

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border bg-transparent px-2.5 text-control font-medium motion-safe:transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-8 ${tone}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="inline-flex items-center" aria-hidden="true">
          {chipIcon(state)}
        </span>
        <span className="hidden sm:inline" aria-hidden="true">
          {label}
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {label}
      </span>
      {open ? (
        <div
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-edge bg-card p-4 text-control shadow-xl"
          role="dialog"
          aria-label="Save and connection state"
        >
          <p className="m-0 text-ui font-semibold text-strong">{label}</p>
          {savedAt === null ? (
            <p className="mb-0 mt-2 text-muted">
              This note has no saved version yet.
            </p>
          ) : (
            <p className="mb-0 mt-2 text-muted">Last saved {savedAt}.</p>
          )}
          <p className="mb-0 mt-2 text-muted">
            {syncStateMessage(sync.state, sync.noteName)}
          </p>
          {note?.state === 'save-failed' || note?.state === 'storage-full' ? (
            <p className="mb-0 mt-2 text-danger" role="alert">
              The note stays open with its text. Copy it before you close the
              tab.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {attentionCount > 0 || problem ? (
              <Link
                className="inline-flex min-h-11 items-center rounded-lg px-2 text-control font-medium text-accent no-underline hover:bg-hover hover:underline focus-visible:outline-2 focus-visible:outline-focus md:min-h-8"
                to={`/w/${workspaceId}/attention`}
                onClick={() => setOpen(false)}
              >
                {attentionTitle}
              </Link>
            ) : null}
            {canCopy ? (
              <Button
                variant="secondary"
                size="sm"
                icon={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                onClick={() => {
                  const copy = onCopyBuffer;
                  if (copy === undefined) return;
                  void copy(note.bufferText).then((ok) => {
                    setCopied(ok);
                  });
                }}
              >
                {copied ? 'Copied' : 'Copy note text'}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
