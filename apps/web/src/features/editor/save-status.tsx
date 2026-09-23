/**
 * The save state channel of the open note.
 *
 * The note screen publishes what it knows about the open note through
 * `NoteSaveScope`. The note saves itself, so no control reports the result;
 * the note states a failed local write itself (`lib/local-write.ts`). The
 * shell reads the same channel for the facts it needs about the open note. The note screen keeps
 * `data-save-state` on its root, so automation reads the note state without
 * reading copy and only one element carries it.
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
import type { NoteSaveFacts } from '../../lib/save-state.ts';
export { resolveSaveState } from '../../lib/save-state.ts';
export type { SaveState, SaveStateInput } from '../../lib/save-state.ts';

/** What the open note tells the header about itself. */
export type NoteSaveReport = NoteSaveFacts & {
  /** When the last version of this note was created, as an ISO instant. */
  readonly lastSavedAt: string | null;
};

type NoteSaveChannel = {
  readonly report: NoteSaveReport | null;
  readonly publish: (report: NoteSaveReport | null) => void;
  readonly flushDraft: () => Promise<void>;
  readonly registerDraftFlush: (flush: () => Promise<void>) => () => void;
};

const NoteSaveContext = createContext<NoteSaveChannel>({
  report: null,
  publish: () => {},
  flushDraft: () => Promise.resolve(),
  registerDraftFlush: () => () => {},
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
  const draftFlush = useRef<() => Promise<void>>(() => Promise.resolve());
  const publish = useCallback((next: NoteSaveReport | null): void => {
    setReport(next);
  }, []);
  const flushDraft = useCallback((): Promise<void> => draftFlush.current(), []);
  const registerDraftFlush = useCallback(
    (flush: () => Promise<void>): (() => void) => {
      draftFlush.current = flush;
      return () => {
        if (draftFlush.current === flush)
          draftFlush.current = () => Promise.resolve();
      };
    },
    [],
  );
  const value = useMemo<NoteSaveChannel>(
    () => ({ report, publish, flushDraft, registerDraftFlush }),
    [report, publish, flushDraft, registerDraftFlush],
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

/** Writes the open editor buffer to the local draft store. */
export function useFlushNoteDraft(): () => Promise<void> {
  return useContext(NoteSaveContext).flushDraft;
}

/** Registers the local draft write of the open editor. */
export function useRegisterNoteDraftFlush(flush: () => Promise<void>): void {
  const { registerDraftFlush } = useContext(NoteSaveContext);
  useEffect(() => registerDraftFlush(flush), [registerDraftFlush, flush]);
}

/** Publishes the save facts of the open note while that screen is mounted. */
export function usePublishNoteSave(report: NoteSaveReport): void {
  const { publish } = useContext(NoteSaveContext);
  const { state, hasUnsavedEdits, localWriteFailed, lastSavedAt } = report;
  useEffect(() => {
    publish({ state, hasUnsavedEdits, localWriteFailed, lastSavedAt });
    return () => {
      publish(null);
    };
  }, [publish, state, hasUnsavedEdits, localWriteFailed, lastSavedAt]);
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
