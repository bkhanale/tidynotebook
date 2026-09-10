/**
 * Account screens: first-run setup, login, and settings.
 *
 * Settings is the one place for the profile, the palette, offline
 * availability, and sign-out. Theme changes apply locally first and sync in
 * the background through the provider in `app.tsx`.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import {
  createOwner,
  getSetupStatus,
  signInWithPassword,
} from '@notesapp/api-client';
import type { LocalStore } from '@notesapp/sync';
import {
  Button,
  ChevronLeftIcon,
  SelectField,
  StatusRegion,
  TextField,
  WorkspaceIcon,
} from '@notesapp/ui';
import {
  problemMessage,
  useLocalStore,
  useSession,
  useTheme,
  useWorkspace,
} from '../app.tsx';
import {
  signOut as endSession,
  revokeSessionViaClient,
} from '../pwa/lifecycle.ts';

/** Redirects to login when no session exists. */
export function RequireSession({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const session = useSession();
  if (session.status === 'loading') {
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <StatusRegion message="Checking the session." />
      </main>
    );
  }
  if (session.status === 'signed-out' || session.account === null) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

/** First-run setup and email-password login. */
export function LoginPage(): ReactNode {
  const session = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSetupStatus().then((result) => {
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        setError(problemMessage(result.error));
        return;
      }
      setInitialized(result.data.initialized);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitPassword(): Promise<void> {
    setBusy(true);
    setError('');
    const result =
      initialized === false
        ? await createOwner({ body: { email, password } })
        : await signInWithPassword({ body: { email, password } });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      const status =
        result.response?.status ??
        (typeof result.error === 'object' &&
        result.error !== null &&
        'status' in result.error
          ? (result.error as { readonly status?: number }).status
          : undefined);
      const code =
        typeof result.error === 'object' &&
        result.error !== null &&
        'code' in result.error
          ? (result.error as { readonly code?: string }).code
          : undefined;
      if (
        status === 400 ||
        status === 401 ||
        code === 'unauthenticated' ||
        code === 'invalid_request'
      ) {
        setError(
          initialized === false
            ? 'The account could not be created. Use at least 12 password characters.'
            : 'Incorrect email or password.',
        );
        return;
      }
      setError(problemMessage(result.error));
      return;
    }
    session.refresh();
    void navigate('/');
  }

  if (session.status === 'signed-in') return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-edge-subtle bg-card p-6 shadow-xl sm:p-8">
        <div className="mb-6 flex items-center gap-2.5 text-lg font-semibold text-strong">
          <span
            className="inline-flex size-8 items-center justify-center rounded-lg bg-accent-fill text-on-accent"
            aria-hidden="true"
          >
            <WorkspaceIcon size={18} />
          </span>
          <span>Notesapp</span>
        </div>
        <h1 className="mb-5 mt-0 text-xl font-semibold text-strong">
          {initialized === false ? 'Create your account' : 'Sign in'}
        </h1>
        <form
          onSubmit={(event): void => {
            event.preventDefault();
            void submitPassword();
          }}
        >
          <TextField
            id="login-email"
            label="Address"
            value={email}
            inputType="email"
            autoComplete="email"
            required
            onChange={setEmail}
          />
          <TextField
            id="login-password"
            label="Password"
            value={password}
            inputType="password"
            autoComplete={
              initialized === false ? 'new-password' : 'current-password'
            }
            required
            onChange={setPassword}
          />
          {error !== '' ? (
            <p className="text-control text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-4">
            <Button
              type="submit"
              disabled={busy || initialized === null}
              className="w-full"
            >
              {busy
                ? initialized === false
                  ? 'Creating account.'
                  : 'Signing in.'
                : initialized === false
                  ? 'Create account'
                  : 'Sign in'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Theme settings: local first, synced without delaying the change. */
export function ThemeSettings(): ReactNode {
  const theme = useTheme();
  return (
    <section
      className="space-y-3 rounded-xl border border-edge-subtle bg-card p-5 shadow-sm"
      aria-labelledby="theme-heading"
    >
      <h2
        className="m-0 text-base font-semibold text-strong"
        id="theme-heading"
      >
        Appearance
      </h2>
      <p className="m-0 text-control text-muted">
        System follows the device. Light and Dark use the Tokyo Night palette.
        The choice applies at once on this device and syncs to the account in
        the background.
      </p>
      <SelectField
        id="theme-choice"
        label="Theme"
        value={theme.choice}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        onChange={(value): void => {
          if (value === 'light' || value === 'dark' || value === 'system')
            theme.setChoice(value);
        }}
      />
    </section>
  );
}

/** What is kept on this device for use without a connection. */
type OfflineChoices = {
  readonly images: boolean;
  readonly history: boolean;
};

/**
 * Reads and writes what this device keeps for offline use.
 *
 * Notes are always kept. Images and older versions are larger, so each one
 * is a choice. A choice is on when every known item of that kind is already
 * kept, which is what the store records.
 */
function useOfflineChoices(
  store: LocalStore | null,
  accountId: string | null,
  workspaceId: string | null,
): {
  readonly choices: OfflineChoices;
  readonly ready: boolean;
  readonly setChoice: (kind: keyof OfflineChoices, keep: boolean) => void;
} {
  const [choices, setChoices] = useState<OfflineChoices>({
    images: false,
    history: false,
  });
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (store === null || accountId === null || workspaceId === null) {
      setReady(false);
      return;
    }
    const activeStore = store;
    let cancelled = false;
    async function read(): Promise<void> {
      try {
        const files = await activeStore.listAcceptedFiles(
          accountId ?? '',
          workspaceId ?? '',
        );
        const images = files.filter(
          (file) => file.kind === 'attachment' && !file.deleted,
        );
        const versions = files.filter((file) => !file.deleted);
        let allImages = images.length > 0;
        for (const file of images) {
          if (file.acceptedHeadDigest === null) continue;
          if (
            !(await activeStore.isAttachmentPinned(
              accountId ?? '',
              workspaceId ?? '',
              file.acceptedHeadDigest,
            ))
          ) {
            allImages = false;
            break;
          }
        }
        let allHistory = versions.length > 0;
        for (const file of versions) {
          if (file.acceptedHeadRevisionId === null) continue;
          if (
            !(await activeStore.isHistoryPinned(
              accountId ?? '',
              workspaceId ?? '',
              file.acceptedHeadRevisionId,
            ))
          ) {
            allHistory = false;
            break;
          }
        }
        if (cancelled) return;
        setChoices({ images: allImages, history: allHistory });
        setReady(true);
      } catch {
        if (!cancelled) setReady(false);
      }
    }
    void read();
    return () => {
      cancelled = true;
    };
  }, [store, accountId, workspaceId, generation]);

  const setChoice = useCallback(
    (kind: keyof OfflineChoices, keep: boolean): void => {
      if (store === null || accountId === null || workspaceId === null) return;
      const activeStore = store;
      const activeAccount = accountId;
      const activeWorkspace = workspaceId;
      setChoices((current) => ({ ...current, [kind]: keep }));
      void (async (): Promise<void> => {
        const files = await activeStore.listAcceptedFiles(
          activeAccount,
          activeWorkspace,
        );
        for (const file of files) {
          if (kind === 'images') {
            if (file.kind !== 'attachment' || file.acceptedHeadDigest === null)
              continue;
            await activeStore.setAttachmentPinned(
              activeAccount,
              activeWorkspace,
              file.acceptedHeadDigest,
              keep,
            );
          } else {
            if (file.acceptedHeadRevisionId === null) continue;
            await activeStore.setHistoryPinned(
              activeAccount,
              activeWorkspace,
              file.acceptedHeadRevisionId,
              keep,
            );
          }
        }
        setGeneration((value) => value + 1);
      })();
    },
    [store, accountId, workspaceId],
  );

  return { choices, ready, setChoice };
}

/** Account page: profile, theme, offline availability, and sign-out. */
export function AccountSettingsPage(): ReactNode {
  const session = useSession();
  const store = useLocalStore();
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [signOutError, setSignOutError] = useState('');
  const account = session.account;
  const accountId = account?.accountId ?? null;
  const workspaceId =
    workspace.state.status === 'ready' ? workspace.state.workspaceId : null;
  const offline = useOfflineChoices(store.store, accountId, workspaceId);

  useEffect(() => {
    if (store.store === null || accountId === null || workspaceId === null) {
      setPendingCount(null);
      return;
    }
    const activeStore = store.store;
    let cancelled = false;
    void activeStore
      .pending(accountId, workspaceId)
      .then((queue) => {
        if (!cancelled) setPendingCount(queue.length);
      })
      .catch(() => {
        if (!cancelled) setPendingCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [store.store, accountId, workspaceId]);

  if (account === null) return <Navigate to="/login" replace />;
  const pending = pendingCount ?? 0;

  function handleBack(): void {
    if (window.history.length > 1) {
      void navigate(-1);
    } else {
      void navigate('/');
    }
  }

  /**
   * Ends the session on this device.
   *
   * `discard` removes the work that never reached the server. Without it the
   * queued work stays on this device and waits for the next sign-in. Offline
   * sign-out records a marker, so the session is revoked on reconnect before
   * any content comes back.
   */
  function endSignOut(discard: boolean): void {
    setSignOutError('');
    const activeStore = store.store;
    if (!discard || activeStore === null || workspaceId === null) {
      session.signOut();
      return;
    }
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    void endSession(
      activeStore,
      account?.accountId ?? '',
      [workspaceId],
      online,
      true,
      revokeSessionViaClient,
    )
      .then(() => {
        session.refresh();
      })
      .catch((failure: unknown) => {
        setSignOutError(problemMessage(failure));
      });
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          onClick={handleBack}
          label="Back"
          icon={<ChevronLeftIcon size={14} />}
        >
          Back
        </Button>
        <h1 className="m-0 text-xl font-semibold text-strong">Settings</h1>
      </div>

      <section
        className="space-y-3 rounded-xl border border-edge-subtle bg-card p-5 shadow-sm"
        aria-labelledby="profile-heading"
      >
        <h2
          className="m-0 text-base font-semibold text-strong"
          id="profile-heading"
        >
          Account
        </h2>
        <p className="m-0 text-control text-muted">
          {account.email ?? 'No address linked'}
        </p>
      </section>

      <ThemeSettings />

      <section
        className="space-y-3 rounded-xl border border-edge-subtle bg-card p-5 shadow-sm"
        aria-labelledby="offline-heading"
      >
        <h2
          className="m-0 text-base font-semibold text-strong"
          id="offline-heading"
        >
          Available offline
        </h2>
        <p className="m-0 text-control text-muted">
          Your notes are always kept on this device. Images and older versions
          take more space, so you choose whether to keep them too.
        </p>
        <label className="flex items-center gap-2 text-control text-strong">
          <input
            type="checkbox"
            checked={offline.choices.images}
            disabled={!offline.ready}
            onChange={(event): void => {
              offline.setChoice('images', event.target.checked);
            }}
          />
          Keep images on this device
        </label>
        <label className="flex items-center gap-2 text-control text-strong">
          <input
            type="checkbox"
            checked={offline.choices.history}
            disabled={!offline.ready}
            onChange={(event): void => {
              offline.setChoice('history', event.target.checked);
            }}
          />
          Keep older versions on this device
        </label>
      </section>

      <section
        className="space-y-3 rounded-xl border border-edge-subtle bg-card p-5 shadow-sm"
        aria-labelledby="signout-heading"
      >
        <h2
          className="m-0 text-base font-semibold text-strong"
          id="signout-heading"
        >
          Sign out
        </h2>
        {pending > 0 ? (
          <p className="m-0 text-control text-danger" role="alert">
            {pending} save(s) did not reach the server yet. Keep them on this
            device for the next sign-in, or remove them now.
          </p>
        ) : null}
        {signOutError !== '' ? (
          <p className="m-0 text-control text-danger" role="alert">
            {signOutError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              endSignOut(false);
            }}
          >
            {pending > 0 ? 'Sign out and keep them' : 'Sign out on this device'}
          </Button>
          {pending > 0 ? (
            <Button
              variant="danger"
              onClick={() => {
                endSignOut(true);
              }}
            >
              Sign out and remove them
            </Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
