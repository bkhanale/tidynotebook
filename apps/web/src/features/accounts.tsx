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
  createAgentToken,
  getSetupStatus,
  listAgentTokens,
  listWorkspaces,
  revokeAgentToken,
  signInWithPassword,
  type Action,
  type AgentToken,
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

const agentTokenExpiryDays = 30;

/** Agent token list, creation with a one-time secret, and revocation. */
function AgentTokens(): ReactNode {
  const [tokens, setTokens] = useState<readonly AgentToken[]>([]);
  const [workspaces, setWorkspaces] = useState<
    readonly { readonly id: string; readonly name: string }[]
  >([]);
  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [read, setRead] = useState(true);
  const [write, setWrite] = useState(false);
  const [history, setHistory] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    const [listed, spaces] = await Promise.all([
      listAgentTokens(),
      listWorkspaces(),
    ]);
    if (listed.error !== undefined || listed.data === undefined) {
      setError(problemMessage(listed.error));
      return;
    }
    setTokens(listed.data.tokens);
    if (spaces.error === undefined && spaces.data !== undefined) {
      const entries = spaces.data.workspaces.map((entry) => ({
        id: entry.workspaceId,
        name: entry.name,
      }));
      setWorkspaces(entries);
      if (workspaceId === '' && entries.length > 0)
        setWorkspaceId(entries[0]?.id ?? '');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(): Promise<void> {
    if (workspaceId === '') {
      setError('Choose a workspace for the token scope.');
      return;
    }
    setBusy(true);
    setError('');
    setSecret(null);
    const actions: Action[] = [];
    if (read) actions.push('read');
    if (write) actions.push('write');
    if (history) actions.push('history');
    const expiresAt = new Date(
      Date.now() + agentTokenExpiryDays * 24 * 3600 * 1000,
    ).toISOString();
    const result = await createAgentToken({
      body: {
        name,
        expiresAt,
        scopes: [{ workspaceId, actions }],
      },
    });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      setError(problemMessage(result.error));
      return;
    }
    setSecret(result.data.secret);
    setName('');
    await load();
  }

  async function revoke(tokenId: string): Promise<void> {
    setError('');
    const result = await revokeAgentToken({ path: { tokenId } });
    if (result.error !== undefined) {
      setError(problemMessage(result.error));
      return;
    }
    await load();
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-edge-subtle bg-card p-5 shadow-sm"
      aria-labelledby="tokens-heading"
    >
      <h2
        className="m-0 text-base font-semibold text-strong"
        id="tokens-heading"
      >
        Agent tokens
      </h2>
      <p>
        Tokens expire after 30 days and never exceed the workspace role. The
        secret shows once, right after creation.
      </p>
      {secret !== null ? (
        <p role="alert">
          Copy the secret now; it never shows again: <code>{secret}</code>
        </p>
      ) : null}
      {error !== '' ? (
        <p className="text-control text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="m-0 list-none space-y-2 p-0">
        {tokens.map((token) => (
          <li
            className="flex items-center justify-between rounded-lg bg-hover px-3 py-2"
            key={token.id}
          >
            <span>
              <strong>{token.name}</strong> ({token.prefix})
            </span>
            <Button variant="secondary" onClick={() => void revoke(token.id)}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      <h3 className="mb-0 mt-2 text-base font-semibold text-strong">
        Create a token
      </h3>
      <form
        onSubmit={(event): void => {
          event.preventDefault();
          void create();
        }}
        className="flex flex-col gap-3"
      >
        <TextField
          id="token-name"
          label="Token name"
          value={name}
          required
          onChange={setName}
        />
        <SelectField
          id="token-workspace"
          label="Workspace scope"
          value={workspaceId}
          options={workspaces.map((entry) => ({
            value: entry.id,
            label: entry.name,
          }))}
          onChange={setWorkspaceId}
        />
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-1.5 text-control">
            <input
              type="checkbox"
              checked={read}
              onChange={(event): void => {
                setRead(event.target.checked);
              }}
            />
            Read
          </label>
          <label className="inline-flex items-center gap-1.5 text-control">
            <input
              type="checkbox"
              checked={write}
              onChange={(event): void => {
                setWrite(event.target.checked);
              }}
            />
            Write
          </label>
          <label className="inline-flex items-center gap-1.5 text-control">
            <input
              type="checkbox"
              checked={history}
              onChange={(event): void => {
                setHistory(event.target.checked);
              }}
            />
            History
          </label>
        </div>
        <div>
          <Button type="submit" disabled={busy || name === ''}>
            {busy ? 'Creating.' : 'Create token'}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Account page: identity, theme, agent tokens, and sign-out. */
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
      <AgentTokens />

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
