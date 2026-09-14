/**
 * Application composition of the notesapp web client.
 *
 * This module wires the maintained pieces together: the generated HTTP
 * client, the IndexedDB local store, the foreground sync engine, and the
 * theme registry. Feature screens consume the providers below and call
 * generated operations directly; there is no second network layer here.
 */
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getAccount,
  listWorkspaces,
  signOut,
  updatePreferences,
  type Account,
  type Preferences,
} from '@notesapp/api-client';
import { generateUUID } from '@notesapp/core';
import { openLocalStore } from '@notesapp/storage-browser';
import {
  createSyncEngine,
  type LocalStore,
  type SyncNotice,
} from '@notesapp/sync';
import {
  appearanceStorageKey,
  applyThemeToDocument,
  defaultThemeFamilyId,
  parseAppearanceChoice,
  parseThemeFamilyId,
  resolveAppearance,
  themeFamilyStorageKey,
  themeFor,
  type Appearance,
  type AppearanceChoice,
  type Theme,
} from '@notesapp/ui';
import { displayNoteName } from './lib/note-name.ts';
import { problemSentence } from './lib/problem-text.ts';
import {
  startingSyncState,
  syncStateFileId,
  syncStateOfNotice,
  syncStateOfQueue,
  type SyncState,
} from './lib/sync-state.ts';
import { subscribeToSystemTheme, systemPrefersDark } from './platform.ts';
import { webLogger } from './logging.ts';

/** Reads one property of an unknown value without asserting its shape. */
function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/**
 * Turns a generated failure into one plain sentence for the person.
 *
 * The sentence never carries a problem code, a status number, a note
 * identifier, or note content. The code goes to the browser console, where
 * it is available for a report without reaching the screen.
 */
export function problemMessage(error: unknown): string {
  const code = readProperty(error, 'code');
  const status = readProperty(error, 'status');
  const knownCode = typeof code === 'string' && code !== '' ? code : null;
  const knownStatus = typeof status === 'number' ? status : null;
  if (knownCode !== null)
    webLogger.emit('web.problem', { problemCode: knownCode });
  return problemSentence(knownCode, knownStatus);
}

/** Where the session stands. */
export type SessionStatus = 'loading' | 'signed-in' | 'signed-out';

/** The signed-in account, or why there is none yet. */
export type SessionValue = {
  readonly status: SessionStatus;
  readonly account: Account | null;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly signOut: () => void;
};

const SessionContext = createContext<SessionValue>({
  status: 'loading',
  account: null,
  error: null,
  refresh: () => {},
  signOut: () => {},
});

const cachedAccountKey = 'notesapp.cached-account';
const syncWorkerKey = 'notesapp.sync-worker';

/** Reads only a previously validated account shape from browser storage. */
function readCachedAccount(): Account | null {
  try {
    const source = window.localStorage.getItem(cachedAccountKey);
    if (source === null) return null;
    const value: unknown = JSON.parse(source);
    if (value === null || typeof value !== 'object') return null;
    const row: Record<string, unknown> = Object.fromEntries(
      Object.entries(value),
    );
    const appearance = readProperty(row['preferences'], 'appearance');
    const themeFamily = readProperty(row['preferences'], 'themeFamily');
    if (
      typeof row['accountId'] !== 'string' ||
      !['system', 'light', 'dark'].includes(String(appearance))
    )
      return null;
    const email = row['email'];
    const name = row['name'];
    if (email !== undefined && email !== null && typeof email !== 'string')
      return null;
    if (name !== undefined && name !== null && typeof name !== 'string')
      return null;
    return {
      accountId: row['accountId'],
      email: email ?? null,
      name: name ?? null,
      preferences: {
        appearance:
          appearance === 'light' || appearance === 'dark'
            ? appearance
            : 'system',
        themeFamily:
          typeof themeFamily === 'string' && themeFamily !== ''
            ? themeFamily
            : defaultThemeFamilyId,
      },
    };
  } catch {
    return null;
  }
}

function rememberAccount(account: Account | null): void {
  try {
    if (account === null) window.localStorage.removeItem(cachedAccountKey);
    else window.localStorage.setItem(cachedAccountKey, JSON.stringify(account));
  } catch {
    // The live session remains usable when browser preference storage fails.
  }
}

/** Keeps one lease owner through reloads, but not across independent tabs. */
function syncWorkerId(): string {
  try {
    const stored = window.sessionStorage.getItem(syncWorkerKey);
    if (stored !== null && stored !== '') return stored;
    const created = generateUUID();
    window.sessionStorage.setItem(syncWorkerKey, created);
    return created;
  } catch {
    return generateUUID();
  }
}

/** Reads the current session value. */
export function useSession(): SessionValue {
  return useContext(SessionContext);
}

/** Loads the account once and reloads it whenever `generation` changes. */
function useSessionLoader(generation: number): {
  readonly status: SessionStatus;
  readonly account: Account | null;
  readonly error: string | null;
} {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setStatus('loading');
      setError(null);
      const result = await getAccount();
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        const responseStatus = result.response?.status ?? 0;
        if (responseStatus === 401) {
          rememberAccount(null);
          setAccount(null);
          setStatus('signed-out');
          return;
        }
        const cached = readCachedAccount();
        if (
          cached !== null &&
          (responseStatus === 0 || responseStatus >= 500)
        ) {
          setAccount(cached);
          setStatus('signed-in');
          setError('The account is offline. Local notes remain available.');
          return;
        }
        setAccount(null);
        setStatus('signed-out');
        setError(problemMessage(result.error));
        return;
      }
      rememberAccount(result.data);
      setAccount(result.data);
      setStatus('signed-in');
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [generation]);

  return { status, account, error };
}

/** Where the one workspace of this account stands. */
export type WorkspaceState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly workspaceId: string };

/** The one workspace with a way to ask for it again. */
export type WorkspaceValue = {
  readonly state: WorkspaceState;
  readonly reload: () => void;
};

const WorkspaceContext = createContext<WorkspaceValue>({
  state: { status: 'loading' },
  reload: () => {},
});

/**
 * Reads the one workspace of the signed-in account.
 *
 * Every screen that needs the workspace reads it here. The list operation
 * runs once for the session instead of once for every screen that mounts.
 */
export function useWorkspace(): WorkspaceValue {
  return useContext(WorkspaceContext);
}

const cachedWorkspaceKey = 'notesapp.cached-workspace-id:';

/** Reads the last known workspace of one account, for an offline start. */
function readCachedWorkspaceId(accountId: string): string | null {
  try {
    const stored = window.localStorage.getItem(
      `${cachedWorkspaceKey}${accountId}`,
    );
    return stored === null || stored === '' ? null : stored;
  } catch {
    return null;
  }
}

function rememberWorkspaceId(accountId: string, workspaceId: string): void {
  try {
    window.localStorage.setItem(
      `${cachedWorkspaceKey}${accountId}`,
      workspaceId,
    );
  } catch {
    // The live workspace stays usable when cache storage fails.
  }
}

/**
 * Resolves the one workspace of the signed-in account.
 *
 * The personal workspace wins when the server answers with more than one, so
 * data that an older installation created cannot hide the notes of the owner.
 * A network failure falls back to the last known workspace of this account,
 * which keeps offline notes reachable after a reload.
 */
function useWorkspaceLoader(
  status: SessionStatus,
  accountId: string | null,
  generation: number,
): WorkspaceState {
  const [state, setState] = useState<WorkspaceState>({ status: 'loading' });

  useEffect(() => {
    if (status !== 'signed-in' || accountId === null) {
      setState({ status: 'loading' });
      return;
    }
    const activeAccount = accountId;
    let cancelled = false;
    async function load(): Promise<void> {
      setState({ status: 'loading' });
      const result = await listWorkspaces();
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        const cached = readCachedWorkspaceId(activeAccount);
        const responseStatus = result.response?.status ?? 0;
        if (cached !== null && (responseStatus === 0 || responseStatus >= 500))
          setState({ status: 'ready', workspaceId: cached });
        else
          setState({ status: 'error', message: problemMessage(result.error) });
        return;
      }
      const workspaces = result.data.workspaces;
      const chosen =
        workspaces.find((workspace) => workspace.personal) ?? workspaces[0];
      if (chosen === undefined) {
        setState({
          status: 'error',
          message: 'This account has no notes area yet.',
        });
        return;
      }
      rememberWorkspaceId(activeAccount, chosen.workspaceId);
      setState({ status: 'ready', workspaceId: chosen.workspaceId });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [status, accountId, generation]);

  return state;
}

/** What the sync engine of the open workspace reports and accepts. */
export type SyncValue = {
  /** Where sync stands, as a typed value the view selects copy from. */
  readonly state: SyncState;
  /** The note the state speaks about, when the local list knew its name. */
  readonly noteName: string | null;
  /** Asks the engine for a pass without waiting for its interval. */
  readonly requestSync: () => void;
};

/** The local store of one server origin, once it is open. */
export type StoreValue = {
  readonly origin: string;
  readonly store: LocalStore | null;
  readonly error: string | null;
};

const StoreContext = createContext<StoreValue>({
  origin: '',
  store: null,
  error: null,
});

/** Reads the local store value. */
export function useLocalStore(): StoreValue {
  return useContext(StoreContext);
}

/** Opens the IndexedDB store of the page origin once. */
function useStoreLoader(origin: string): StoreValue {
  const [store, setStore] = useState<LocalStore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function open(): Promise<void> {
      try {
        const opened = await openLocalStore(origin);
        if (!cancelled) setStore(opened);
        else await opened.close();
      } catch (failure: unknown) {
        if (!cancelled) {
          const detail =
            failure instanceof Error && failure.cause instanceof Error
              ? `: ${failure.cause.message}`
              : '';
          setError(
            failure instanceof Error
              ? `${failure.message}${detail}`
              : 'Local storage is unavailable.',
          );
        }
      }
    }
    void open();
    return () => {
      cancelled = true;
    };
  }, [origin]);

  return useMemo(() => ({ origin, store, error }), [origin, store, error]);
}

/** The appearance choice, the theme family, and the palette in force. */
export type ThemeValue = {
  readonly choice: AppearanceChoice;
  readonly resolved: Appearance;
  /** The identifier of the chosen family, for example `tokyo-night`. */
  readonly familyId: string;
  /** The palette that the document renders with right now. */
  readonly theme: Theme;
  readonly setChoice: (choice: AppearanceChoice) => void;
  readonly setFamily: (familyId: string) => void;
  /** Why the choice did not reach the account, when that happened. */
  readonly syncError: string | null;
};

const startingTheme = themeFor(parseThemeFamilyId(undefined), 'dark');

const ThemeContext = createContext<ThemeValue>({
  choice: 'system',
  resolved: 'dark',
  familyId: startingTheme.family,
  theme: startingTheme,
  setChoice: () => {},
  setFamily: () => {},
  syncError: null,
});

/** Reads the theme value. */
export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/** Reads one local settings value without trusting its shape. */
function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Owns the appearance choice and the theme family.
 *
 * Both are stored locally first so the next paint is already correct, then
 * synced to the account in the background without delaying the local change.
 * A failed sync keeps the local choice and reports it; it never rolls the
 * visible theme back. A device that has never chosen adopts the settings of
 * the account, so a second device opens in the palette of the first.
 */
function useThemeLoader(stored: Preferences | null): ThemeValue {
  const [choice, setChoiceState] = useState<AppearanceChoice>(() =>
    parseAppearanceChoice(readSetting(appearanceStorageKey)),
  );
  const [familyId, setFamilyState] = useState<string>(() =>
    parseThemeFamilyId(readSetting(themeFamilyStorageKey)),
  );
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);
  const [syncError, setSyncError] = useState<string | null>(null);
  const resolved = resolveAppearance(choice, prefersDark);
  const theme = themeFor(familyId, resolved);

  useEffect(() => {
    return subscribeToSystemTheme(setPrefersDark);
  }, []);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // The account settings arrive after the first paint. They apply only when
  // this device never chose, so a local choice is never overwritten by an
  // older one from the account.
  useEffect(() => {
    if (stored === null) return;
    if (readSetting(appearanceStorageKey) === null)
      setChoiceState(parseAppearanceChoice(stored.appearance));
    if (readSetting(themeFamilyStorageKey) === null)
      setFamilyState(parseThemeFamilyId(stored.themeFamily));
  }, [stored]);

  const store = useCallback(
    (nextChoice: AppearanceChoice, nextFamily: string): boolean => {
      try {
        window.localStorage.setItem(appearanceStorageKey, nextChoice);
        window.localStorage.setItem(themeFamilyStorageKey, nextFamily);
        return true;
      } catch {
        setSyncError('The theme could not be stored on this device.');
        return false;
      }
    },
    [],
  );

  const publish = useCallback(
    (nextChoice: AppearanceChoice, nextFamily: string): void => {
      if (!store(nextChoice, nextFamily)) return;
      async function sync(): Promise<void> {
        const result = await updatePreferences({
          body: { appearance: nextChoice, themeFamily: nextFamily },
        });
        if (result.error !== undefined)
          setSyncError(
            'The theme is set on this device but not on your account yet.',
          );
        else setSyncError(null);
      }
      void sync();
    },
    [store],
  );

  const setChoice = useCallback(
    (next: AppearanceChoice) => {
      setChoiceState(next);
      publish(next, familyId);
    },
    [publish, familyId],
  );

  const setFamily = useCallback(
    (next: string) => {
      const known = parseThemeFamilyId(next);
      setFamilyState(known);
      publish(choice, known);
    },
    [publish, choice],
  );

  return useMemo(
    () => ({
      choice,
      resolved,
      familyId,
      theme,
      setChoice,
      setFamily,
      syncError,
    }),
    [choice, resolved, familyId, theme, setChoice, setFamily, syncError],
  );
}

/**
 * The note name of one file, or a general phrase when it is unknown.
 *
 * A status line must never show a raw identifier. The local file list is the
 * only place a name is needed from, so a read failure falls back to words.
 */
async function noteNameOf(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  fileId: string | undefined,
): Promise<string> {
  if (fileId === undefined) return 'a note';
  try {
    const files = await store.listLocalFiles(accountId, workspaceId);
    const path = files.find((file) => file.fileId === fileId)?.path;
    return path === undefined ? 'a note' : displayNoteName(path);
  } catch {
    return 'a note';
  }
}

/**
 * Runs the foreground sync engine of one workspace.
 *
 * Returns the typed sync state. The engine only announces changes, so the
 * returned state stays until the next announcement. The view selects the
 * sentence from the state; no screen reads engine prose.
 */
export function useWorkspaceSync(
  store: LocalStore | null,
  accountId: string | null,
  workspaceId: string | null,
): SyncValue {
  const [state, setState] = useState<SyncState>(startingSyncState);
  const [noteName, setNoteName] = useState<string | null>(null);
  const ownerId = useMemo(syncWorkerId, []);
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    if (store === null || accountId === null || workspaceId === null) {
      setState(startingSyncState);
      setNoteName(null);
      return;
    }
    const activeStore = store;
    const activeAccount = accountId;
    const activeWorkspace = workspaceId;
    const controller = new AbortController();
    const onNotice = (notice: SyncNotice): void => {
      const next = syncStateOfNotice(notice);
      if (next === null) return;
      setState(next);
      if (next.kind === 'superseded' || next.kind === 'delete-refused') {
        setNoteName(displayNoteName(next.path));
        return;
      }
      const fileId = syncStateFileId(next);
      if (fileId === null) {
        setNoteName(null);
        return;
      }
      void noteNameOf(activeStore, activeAccount, activeWorkspace, fileId).then(
        setNoteName,
      );
    };
    const engine = createSyncEngine(store, accountId, workspaceId, {
      announce: onNotice,
      ownerId,
    });
    const requestSync = (): void => {
      engine.requestSync();
    };
    wake.current = requestSync;
    /**
     * Reports what the queue of this device holds right now.
     *
     * The engine announces only what it did, so a device with nothing to
     * send never reports anything. The count of queued saves fills that
     * gap and keeps a quiet state honest: a queued save means a send is in
     * progress, an empty queue means everything reached the server.
     */
    const readQueue = (): void => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setState({ kind: 'waiting' });
        return;
      }
      void activeStore
        .pending(activeAccount, activeWorkspace)
        .then((entries) => {
          setState((current) => syncStateOfQueue(current, entries.length));
        })
        .catch(() => {
          // A queue that cannot be read changes nothing the person needs to
          // act on; the engine reports a real failure on its own.
        });
    };
    const unsubscribe = store.subscribe((change) => {
      if (
        change.accountId === accountId &&
        change.workspaceId === workspaceId &&
        change.kind === 'queue'
      ) {
        readQueue();
        requestSync();
      }
    });
    const onOnline = (): void => {
      readQueue();
      requestSync();
    };
    const onOffline = (): void => {
      setState({ kind: 'waiting' });
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', requestSync);
    readQueue();
    void engine.run(controller.signal).catch(() => {
      setState({ kind: 'stopped' });
    });
    return () => {
      unsubscribe();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', requestSync);
      controller.abort();
      engine.stop();
      wake.current = () => {};
    };
  }, [store, accountId, workspaceId, ownerId]);

  const requestSync = useCallback((): void => {
    wake.current();
  }, []);
  return useMemo(
    () => ({ state, noteName, requestSync }),
    [state, noteName, requestSync],
  );
}

const SyncContext = createContext<SyncValue>({
  state: startingSyncState,
  noteName: null,
  requestSync: () => {},
});

/** Reads the sync state of the open notes area. */
export function useSyncState(): SyncValue {
  return useContext(SyncContext);
}

/** Publishes the sync state of the open workspace to the screens below. */
export function SyncProvider({
  value,
  children,
}: {
  readonly value: SyncValue;
  readonly children: ReactNode;
}): ReactNode {
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * Asks the sync engine for a pass now.
 *
 * A screen calls this after it changed workspace state through the server, so
 * the local cache follows at once instead of at the next safety interval.
 */
export function useRequestSync(): () => void {
  return useContext(SyncContext).requestSync;
}

/**
 * Provides session, workspace, store, and theme to the whole application.
 *
 * The `key` of the `SessionScope` below is the account ID: when the account
 * changes, every screen remounts and no private state leaks across accounts.
 */
export function AppProviders({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const origin = useMemo(() => window.location.origin, []);
  const storeValue = useStoreLoader(origin);
  const [generation, setGeneration] = useState(0);
  const session = useSessionLoader(generation);
  const theme = useThemeLoader(session.account?.preferences ?? null);
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0);
  const workspaceState = useWorkspaceLoader(
    session.status,
    session.account?.accountId ?? null,
    workspaceGeneration,
  );

  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  const doSignOut = useCallback(() => {
    async function end(): Promise<void> {
      rememberAccount(null);
      await signOut({ body: {} });
      refresh();
    }
    void end();
  }, [refresh]);

  const sessionValue = useMemo<SessionValue>(
    () => ({
      status: session.status,
      account: session.account,
      error: session.error,
      refresh,
      signOut: doSignOut,
    }),
    [session, refresh, doSignOut],
  );

  const workspaceValue = useMemo<WorkspaceValue>(
    () => ({
      state: workspaceState,
      reload: () => {
        setWorkspaceGeneration((current) => current + 1);
      },
    }),
    [workspaceState],
  );

  const themeValue = useMemo<ThemeValue>(() => theme, [theme]);

  return (
    <ThemeContext.Provider value={themeValue}>
      <StoreContext.Provider value={storeValue}>
        <SessionContext.Provider value={sessionValue}>
          <WorkspaceContext.Provider value={workspaceValue}>
            <SessionScope
              accountKey={session.account?.accountId ?? 'signed-out'}
            >
              {children}
            </SessionScope>
          </WorkspaceContext.Provider>
        </SessionContext.Provider>
      </StoreContext.Provider>
    </ThemeContext.Provider>
  );
}

/**
 * Remounts its children whenever the signed-in account changes.
 *
 * The key rides on a fragment, so the application tree gets a new identity
 * without a node in the layout. React compares the key of the one child it
 * holds: a new account gives a new key, so React drops the whole tree below
 * and builds it again. Every store, cache, and screen state of the account
 * that left goes with it.
 */
function SessionScope({
  accountKey,
  children,
}: {
  readonly accountKey: string;
  readonly children: ReactNode;
}): ReactNode {
  return <Fragment key={accountKey}>{children}</Fragment>;
}
