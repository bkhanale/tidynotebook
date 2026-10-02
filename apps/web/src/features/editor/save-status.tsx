/**
 * The save state channel of the open note.
 *
 * The note screen publishes what the frame shows about the open note through
 * `NoteSaveScope`: a failed local write and the time of the last version. The
 * note saves itself, so no control reports the result; the note states a
 * failed local write itself (`lib/local-write.ts`). The scope holds one
 * store, so the context never changes and a reader renders only when the
 * fact it selects changes. A key changes no such fact (record 0175). The note
 * screen keeps `data-save-state` on its root, so automation reads the note
 * state without reading copy and only one element carries it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  createFactStore,
  sameMembers,
  type FactStore,
} from '../../lib/fact-store.ts';
import type { NoteSaveReport } from '../../lib/save-state.ts';
export { noteSaveReport, resolveSaveState } from '../../lib/save-state.ts';
export type {
  NoteSaveReport,
  SaveState,
  SaveStateInput,
} from '../../lib/save-state.ts';

type NoteSaveChannel = {
  readonly report: FactStore<NoteSaveReport | null>;
  readonly flushDraft: () => Promise<void>;
  readonly registerDraftFlush: (flush: () => Promise<void>) => () => void;
};

/** The channel outside a scope: no note, and nothing to flush. */
const noChannel: NoteSaveChannel = {
  report: createFactStore<NoteSaveReport | null>(null, sameMembers),
  flushDraft: () => Promise.resolve(),
  registerDraftFlush: () => () => {},
};

const NoteSaveContext = createContext<NoteSaveChannel>(noChannel);

/**
 * Carries the save facts of the open note up to the frame.
 *
 * The note screen sits under the header in the tree, so the frame owns the
 * store and the note screen writes into it.
 */
export function NoteSaveScope({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const [report] = useState(() =>
    createFactStore<NoteSaveReport | null>(null, sameMembers),
  );
  const draftFlush = useRef<() => Promise<void>>(() => Promise.resolve());
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
    () => ({ report, flushDraft, registerDraftFlush }),
    [report, flushDraft, registerDraftFlush],
  );
  return (
    <NoteSaveContext.Provider value={value}>
      {children}
    </NoteSaveContext.Provider>
  );
}

/**
 * Reads one fact of the open note, or of no note on another screen.
 *
 * `select` must answer a value that compares with `Object.is`, such as a
 * boolean or a string, so a reader renders only when that value changes.
 */
export function useNoteSaveFact<T>(
  select: (report: NoteSaveReport | null) => T,
): T {
  const { report } = useContext(NoteSaveContext);
  return useSyncExternalStore(report.subscribe, () => select(report.get()));
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

/**
 * The writer of the save facts of the open note, for the editor to call when
 * a fact may have changed. The facts go when the screen goes.
 */
export function useNoteSavePublisher(): (report: NoteSaveReport) => void {
  const { report } = useContext(NoteSaveContext);
  useEffect(
    () => () => {
      report.set(null);
    },
    [report],
  );
  return report.set;
}

/**
 * Blocks an unsafe reload while unsaved work sits only in memory.
 *
 * A queued save is durable on this device and survives a reload, so it
 * never blocks. Only text that has not reached local storage yet, and a
 * local write that failed, keep the browser confirmation. The answer sets
 * the guard without a render, because the first key of a burst sets it.
 */
export function useUnsafeReloadGuard(): (blocked: boolean) => void {
  const listening = useRef(false);
  const onBeforeUnload = useCallback((event: BeforeUnloadEvent): void => {
    event.preventDefault();
  }, []);
  useEffect(
    () => () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      listening.current = false;
    },
    [onBeforeUnload],
  );
  return useCallback(
    (blocked: boolean): void => {
      if (blocked === listening.current) return;
      listening.current = blocked;
      if (blocked) window.addEventListener('beforeunload', onBeforeUnload);
      else window.removeEventListener('beforeunload', onBeforeUnload);
    },
    [onBeforeUnload],
  );
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
