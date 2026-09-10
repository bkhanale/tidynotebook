/**
 * Account screens: first-run setup, login, and settings.
 *
 * Theme changes apply locally first and sync in the background through the
 * provider in `app.tsx`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import {
  createOwner,
  getSetupStatus,
  listWorkspaces,
  signInWithPassword,
} from '@notesapp/api-client';
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
} from '../app.tsx';

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
        Theme
      </h2>
      <p className="m-0 text-control text-muted">
        System follows the device. The choice applies at once on this device and
        syncs to the account in the background.
      </p>
      <SelectField
        id="theme-choice"
        label="Palette"
        value={theme.choice}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Tokyo Night Day' },
          { value: 'dark', label: 'Tokyo Night Night' },
        ]}
        onChange={(value): void => {
          if (value === 'light' || value === 'dark' || value === 'system')
            theme.setChoice(value);
        }}
      />
    </section>
  );
}

/** Account page: identity, theme, and sign-out. */
export function AccountSettingsPage(): ReactNode {
  const session = useSession();
  const store = useLocalStore();
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const account = session.account;

  useEffect(() => {
    if (store.store === null || account === null) {
      setPendingCount(null);
      return;
    }
    const activeStore = store.store;
    const activeAccount = account;
    let cancelled = false;
    async function count(): Promise<void> {
      try {
        const spaces = await listWorkspaces();
        if (spaces.error !== undefined || spaces.data === undefined) {
          if (!cancelled) setPendingCount(null);
          return;
        }
        let total = 0;
        for (const entry of spaces.data.workspaces) {
          const queue = await activeStore.pending(
            activeAccount.accountId,
            entry.workspaceId,
          );
          total += queue.length;
        }
        if (!cancelled) setPendingCount(total);
      } catch {
        if (!cancelled) setPendingCount(null);
      }
    }
    void count();
    return () => {
      cancelled = true;
    };
  }, [store.store, account]);

  if (account === null) return <Navigate to="/login" replace />;
  const mustConfirm = (pendingCount ?? 0) > 0;

  function handleBack(): void {
    if (window.history.length > 1) {
      void navigate(-1);
    } else {
      void navigate('/');
    }
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
        <h1 className="m-0 text-xl font-semibold text-strong">Account</h1>
      </div>

      <section
        className="space-y-3 rounded-xl border border-edge-subtle bg-card p-5 shadow-sm"
        aria-labelledby="profile-heading"
      >
        <h2
          className="m-0 text-base font-semibold text-strong"
          id="profile-heading"
        >
          Profile
        </h2>
        <p className="m-0 text-control text-muted">
          {account.email ?? 'No address linked'}
          {account.name !== null &&
          account.name !== undefined &&
          account.name !== ''
            ? ` (${account.name})`
            : null}
        </p>
      </section>

      <ThemeSettings />

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
        {mustConfirm ? (
          <p className="m-0 text-control text-danger" role="alert">
            {String(pendingCount)} change(s) still wait on this device. They
            stay here for recovery; signing out does not upload them.
          </p>
        ) : null}
        {mustConfirm ? (
          <label className="inline-flex items-center gap-1.5 text-control">
            <input
              type="checkbox"
              checked={confirmLeave}
              onChange={(event): void => {
                setConfirmLeave(event.target.checked);
              }}
            />
            I understand pending work stays on this device.
          </label>
        ) : null}
        <div>
          <Button
            variant="secondary"
            disabled={mustConfirm && !confirmLeave}
            onClick={() => session.signOut()}
          >
            Sign out on this device
          </Button>
        </div>
      </section>
    </main>
  );
}
