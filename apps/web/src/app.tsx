/**
 * Application composition of the notesapp web client.
 *
 * This module wires the maintained pieces together: the generated HTTP
 * client, the IndexedDB local store, the foreground sync engine, and the
 * Tokyo Night theme. Feature screens consume the providers below and call
 * generated operations directly; there is no second network layer here.
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
import {
  getAccount,
  signOut,
  updatePreferences,
  type Account,
} from '@notesapp/api-client';
import { generateUUID } from '@notesapp/core';
import { openLocalStore } from '@notesapp/storage-browser';
import {
  createSyncEngine,
  type LocalStore,
  type SyncNotice,
} from '@notesapp/sync';
import {
  applyThemeToDocument,
  parseThemeChoice,
  resolveTheme,
  themeStorageKey,
  type ResolvedTheme,
  type ThemeChoice,
} from '@notesapp/ui';
import { displayNoteName } from './features/note-name.ts';
import { subscribeToSystemTheme, systemPrefersDark } from './platform.ts';

/** Reads one property of an unknown value without asserting its shape. */
function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/**
 * Turns a generated failure into one readable sentence for a status region.
 *
 * The message names the problem code and title only, never note content.
 */
export function problemMessage(error: unknown): string {
  const code = readProperty(error, 'code');
  const title = readProperty(error, 'title');
  const status = readProperty(error, 'status');
  const parts: string[] = [];
  if (typeof code === 'string' && code !== '') parts.push(code);
  if (typeof title === 'string' && title !== '') parts.push(title);
  if (parts.length === 0) {
    if (typeof status === 'number' && status !== 0)
      return `The request failed with status ${String(status)}.`;
    return 'The request did not reach the service.';
  }
  return parts.join(': ');
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
    const preferences = readProperty(row['preferences'], 'theme');
    if (
      typeof row['accountId'] !== 'string' ||
      !['system', 'light', 'dark'].includes(String(preferences))
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
        theme:
          preferences === 'light' || preferences === 'dark'
            ? preferences
            : 'system',
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

/** What the sync engine of the open workspace reports and accepts. */
export type SyncValue = {
  /** One sentence about the last thing the engine did. */
  readonly message: string;
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

/** The theme choice with its resolved palette. */
export type ThemeValue = {
  readonly choice: ThemeChoice;
  readonly resolved: ResolvedTheme;
  readonly setChoice: (choice: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeValue>({
  choice: 'system',
  resolved: 'dark',
  setChoice: () => {},
});

/** Reads the theme value. */
export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/** Reads the stored choice without trusting its shape. */
function readStoredChoice(): ThemeChoice {
  try {
    return parseThemeChoice(window.localStorage.getItem(themeStorageKey));
  } catch {
    return 'system';
  }
}

/**
 * Owns the theme choice.
 *
 * The choice is stored locally first so the next paint is already correct,
 * then synced to the account in the background without delaying the local
 * change. A failed sync keeps the local choice and reports it; it never
 * rolls the visible theme back.
 */
function useThemeLoader(): ThemeValue & { readonly syncError: string | null } {
  const [choice, setChoiceState] = useState<ThemeChoice>(() =>
    readStoredChoice(),
  );
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);
  const [syncError, setSyncError] = useState<string | null>(null);
  const resolved = resolveTheme(choice, prefersDark);

  useEffect(() => {
    return subscribeToSystemTheme(setPrefersDark);
  }, []);

  useEffect(() => {
    applyThemeToDocument(resolved);
  }, [resolved]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      window.localStorage.setItem(themeStorageKey, next);
    } catch {
      setSyncError('The theme choice could not be stored on this device.');
      return;
    }
    async function sync(): Promise<void> {
      const result = await updatePreferences({ body: { theme: next } });
      if (result.error !== undefined)
        setSyncError(
          `The theme is set on this device but not synced: ${problemMessage(result.error)}`,
        );
      else setSyncError(null);
    }
    void sync();
  }, []);

  return useMemo(
    () => ({ choice, resolved, setChoice, syncError }),
    [choice, resolved, setChoice, syncError],
  );
}

/**
 * Runs the foreground sync engine of one workspace.
 *
 * Returns the latest human readable sync state for the status region. The
 * engine only announces state changes; the returned message stays until the
 * next announcement.
 */
export function useWorkspaceSync(
  store: LocalStore | null,
  accountId: string | null,
  workspaceId: string | null,
): SyncValue {
  const [message, setMessage] = useState<string>('Sync has not started yet.');
  const ownerId = useMemo(syncWorkerId, []);
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    if (store === null || accountId === null || workspaceId === null) {
      setMessage('Sync waits for the account and the local store.');
      return;
    }
    const controller = new AbortController();
    const onNotice = (notice: SyncNotice): void => {
      if (notice.kind === 'pushed')
        setMessage(
          `Saved to server: ${String(notice.mutationIds.length)} change(s).`,
        );
      else if (notice.kind === 'preserved')
        setMessage(
          `Local work is preserved: ${notice.mutationId} (${notice.code}).`,
        );
      else if (notice.kind === 'superseded')
        setMessage(
          `Your save of ${displayNoteName(notice.path)} is now the latest version. Text saved from another device is kept in History.`,
        );
      else if (notice.kind === 'delete-refused')
        setMessage(
          `${displayNoteName(notice.path)} changed on another device, so it was not deleted.`,
        );
      else if (notice.kind === 'retry')
        setMessage(
          `Sync retries in ${String(Math.round(notice.delayMs / 1000))} seconds.`,
        );
      else if (notice.kind === 'snapshot-restart')
        setMessage(`Sync restarts the download: ${notice.reason}.`);
      else if (notice.kind === 'snapshot-activated')
        setMessage(
          `Downloaded ${String(notice.count)} revision(s) for offline use.`,
        );
      else if (notice.kind === 'changes-applied')
        setMessage(`Applied ${String(notice.count)} server change(s).`);
      else if (notice.kind === 'paused')
        setMessage('Sync paused: the session expired. Sign in again.');
      else if (notice.kind === 'access-lost')
        setMessage('Sync stopped: this account lost access to the workspace.');
      else if (notice.kind === 'role-downgraded')
        setMessage('Sync paused for writes: the role is now viewer.');
      else if (notice.kind === 'writes-resumed')
        setMessage('Sync resumed writes after a role change.');
      else if (notice.kind === 'lease-held')
        setMessage('Another tab is syncing this workspace.');
      else setMessage('Sync lost its worker lease and retries.');
    };
    const engine = createSyncEngine(store, accountId, workspaceId, {
      announce: onNotice,
      ownerId,
    });
    const requestSync = (): void => {
      engine.requestSync();
    };
    wake.current = requestSync;
    const unsubscribe = store.subscribe((change) => {
      if (
        change.accountId === accountId &&
        change.workspaceId === workspaceId &&
        change.kind === 'queue'
      )
        requestSync();
    });
    window.addEventListener('online', requestSync);
    window.addEventListener('focus', requestSync);
    setMessage('Sync started.');
    void engine.run(controller.signal).catch(() => {
      setMessage('Sync stopped.');
    });
    return () => {
      unsubscribe();
      window.removeEventListener('online', requestSync);
      window.removeEventListener('focus', requestSync);
      controller.abort();
      engine.stop();
      wake.current = () => {};
    };
  }, [store, accountId, workspaceId, ownerId]);

  const requestSync = useCallback((): void => {
    wake.current();
  }, []);
  return useMemo(() => ({ message, requestSync }), [message, requestSync]);
}

const SyncContext = createContext<SyncValue>({
  message: 'Sync has not started yet.',
  requestSync: () => {},
});

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
 * Reads the local snapshot position and the pending queue of one workspace.
 *
 * Used by the status region next to the engine announcements. A failure to
 * read local state is reported but never throws into the layout.
 */
export function useLocalSnapshotStatus(
  store: LocalStore | null,
  accountId: string | null,
  workspaceId: string | null,
): string {
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    if (store === null || accountId === null || workspaceId === null) {
      setMessage('');
      return;
    }
    const activeStore = store;
    const activeAccount = accountId;
    const activeWorkspace = workspaceId;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [cursor, queue] = await Promise.all([
          activeStore.readCursor(activeAccount, activeWorkspace),
          activeStore.pending(activeAccount, activeWorkspace),
        ]);
        if (cancelled) return;
        if (queue.length > 0)
          setMessage(`${String(queue.length)} change(s) wait on this device.`);
        else if (cursor === null) setMessage('No server snapshot yet.');
        else setMessage(`Local snapshot is at ${cursor}.`);
      } catch {
        if (!cancelled) setMessage('Local snapshot status is unavailable.');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [store, accountId, workspaceId]);

  return message;
}

/**
 * Provides session, store, and theme to the whole application.
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
  const theme = useThemeLoader();

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

  const themeValue = useMemo<ThemeValue>(
    () => ({
      choice: theme.choice,
      resolved: theme.resolved,
      setChoice: theme.setChoice,
    }),
    [theme],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <StoreContext.Provider value={storeValue}>
        <SessionContext.Provider value={sessionValue}>
          <SessionScope accountKey={session.account?.accountId ?? 'signed-out'}>
            {children}
          </SessionScope>
        </SessionContext.Provider>
      </StoreContext.Provider>
    </ThemeContext.Provider>
  );
}

/** Remounts its children whenever the signed-in account changes. */
function SessionScope({
  accountKey,
  children,
}: {
  readonly accountKey: string;
  readonly children: ReactNode;
}): ReactNode {
  return <div key={accountKey}>{children}</div>;
}
