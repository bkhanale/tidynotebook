/**
 * Account screens: login, OIDC redirect, invitation acceptance, and settings.
 *
 * Every action calls a generated account or auth operation. The OIDC flow
 * starts through `signInWithProvider` and continues as browser navigation to
 * the address it returns; the provider callback itself is server navigation,
 * not a generated call. Theme changes apply locally first and sync in the
 * background through the provider in `app.tsx`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import {
  acceptInvitation,
  createAgentToken,
  listAgentTokens,
  listWorkspaces,
  revokeAgentToken,
  signInWithPassword,
  signInWithProvider,
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
      <main>
        <StatusRegion message="Checking the session." />
      </main>
    );
  }
  if (session.status === 'signed-out' || session.account === null) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

/** Email and password login plus OIDC start. */
export function LoginPage(): ReactNode {
  const session = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitPassword(): Promise<void> {
    setBusy(true);
    setError('');
    const result = await signInWithPassword({ body: { email, password } });
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
        setError('Incorrect email or password.');
        return;
      }
      setError(problemMessage(result.error));
      return;
    }
    session.refresh();
    void navigate('/');
  }

  async function startOidc(): Promise<void> {
    setBusy(true);
    setError('');
    const result = await signInWithProvider({
      body: {
        provider: 'oidc',
        callbackURL: '/auth/signed-in',
        errorCallbackURL: '/login',
        newUserCallbackURL: '/auth/signed-in',
      },
    });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      setError(problemMessage(result.error));
      return;
    }
    const url = result.data.url;
    if (typeof url !== 'string' || url === '') {
      setError('The provider returned no address to open.');
      return;
    }
    window.location.assign(url);
  }

  if (session.status === 'signed-in') return <Navigate to="/" replace />;

  return (
    <div className="notes-auth-page">
      <div className="notes-auth-card">
        <div className="notes-auth-logo">
          <span className="notes-brand-badge" aria-hidden="true">
            <WorkspaceIcon size={18} />
          </span>
          <span>Notesapp</span>
        </div>
        <h1 style={{ fontSize: '1.25rem', marginTop: 0, marginBottom: '20px' }}>
          Sign in to notesapp
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
            autoComplete="current-password"
            required
            onChange={setPassword}
          />
          {error !== '' ? (
            <p className="notes-status-error" role="alert">
              {error}
            </p>
          ) : null}
          <div style={{ marginTop: '16px' }}>
            <Button type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Signing in.' : 'Sign in'}
            </Button>
          </div>
        </form>
        <div className="notes-auth-divider">
          <span>single sign-on</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p
            style={{
              margin: 0,
              fontSize: '0.8125rem',
              color: 'var(--notes-text-muted)',
            }}
          >
            When the administrator configured a provider, start there instead.
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void startOidc()}
            style={{ width: '100%' }}
          >
            Continue with the configured provider
          </Button>
          <p
            style={{
              textAlign: 'center',
              fontSize: '0.8125rem',
              margin: '8px 0 0',
            }}
          >
            <Link to="/invite">Have an invitation token? Accept it here.</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Landing page after an OIDC round trip; refreshes the session once. */
export function SignedInLanding(): ReactNode {
  const session = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    session.refresh();
  }, []);

  useEffect(() => {
    if (session.status === 'signed-in') void navigate('/');
  }, [session.status, navigate]);

  if (session.status === 'signed-out')
    return (
      <main>
        <h1>Sign-in did not complete</h1>
        <p>The provider returned without a session on this device.</p>
        <p>
          <Link to="/login">Back to sign-in.</Link>
        </p>
      </main>
    );
  return (
    <main>
      <StatusRegion message="Finishing sign-in." />
    </main>
  );
}

/** Accepts a workspace invitation with its token. */
export function InvitePage(): ReactNode {
  const session = useSession();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept(): Promise<void> {
    setBusy(true);
    setError('');
    const result = await acceptInvitation({
      body: password === '' ? { token } : { token, password },
    });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      setError(problemMessage(result.error));
      return;
    }
    setAccepted(
      `Joined workspace ${result.data.workspaceId} as ${result.data.role}.`,
    );
    session.refresh();
  }

  return (
    <div className="notes-auth-page">
      <div className="notes-auth-card">
        <div className="notes-auth-logo">
          <span className="notes-brand-badge" aria-hidden="true">
            <WorkspaceIcon size={18} />
          </span>
          <span>Notesapp</span>
        </div>
        <h1 style={{ fontSize: '1.25rem', marginTop: 0, marginBottom: '16px' }}>
          Accept workspace invitation
        </h1>
        {session.status === 'signed-out' ? (
          <p style={{ fontSize: '0.84rem', color: 'var(--notes-text-muted)' }}>
            Without an account, add a password to create one with the
            invitation. Under a provider-only installation, sign in first with{' '}
            <Link to="/login">the provider</Link> instead.
          </p>
        ) : null}
        <form
          onSubmit={(event): void => {
            event.preventDefault();
            void accept();
          }}
        >
          <TextField
            id="invite-token"
            label="Invitation token"
            value={token}
            required
            onChange={setToken}
          />
          {session.status === 'signed-out' ? (
            <TextField
              id="invite-password"
              label="New password (leave empty when signing in first)"
              value={password}
              inputType="password"
              autoComplete="new-password"
              onChange={setPassword}
            />
          ) : null}
          {error !== '' ? (
            <p className="notes-status-error" role="alert">
              {error}
            </p>
          ) : null}
          {accepted !== null ? (
            <p className="notes-status-ok" role="status">
              {accepted}
            </p>
          ) : null}
          <div style={{ marginTop: '16px' }}>
            <Button
              type="submit"
              disabled={busy || token === ''}
              style={{ width: '100%' }}
            >
              {busy ? 'Accepting.' : 'Accept invitation'}
            </Button>
          </div>
        </form>
        <p
          style={{
            textAlign: 'center',
            fontSize: '0.8125rem',
            marginTop: '16px',
          }}
        >
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

/** Theme settings: local first, synced without delaying the change. */
export function ThemeSettings(): ReactNode {
  const theme = useTheme();
  return (
    <section className="notes-settings-card" aria-labelledby="theme-heading">
      <h2 id="theme-heading" style={{ margin: 0 }}>
        Theme
      </h2>
      <p style={{ margin: 0, color: 'var(--notes-text-muted)' }}>
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
    <section className="notes-settings-card" aria-labelledby="tokens-heading">
      <h2 id="tokens-heading">Agent tokens</h2>
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
        <p className="notes-status-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        {tokens.map((token) => (
          <li
            key={token.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.5rem 0.75rem',
              backgroundColor: 'var(--notes-bg-subtle)',
              borderRadius: 'var(--notes-radius-md)',
            }}
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
      <h3 style={{ margin: '0.5rem 0 0 0', fontSize: '1rem' }}>
        Create a token
      </h3>
      <form
        onSubmit={(event): void => {
          event.preventDefault();
          void create();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
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
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <input
              type="checkbox"
              checked={read}
              onChange={(event): void => {
                setRead(event.target.checked);
              }}
            />{' '}
            Read
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <input
              type="checkbox"
              checked={write}
              onChange={(event): void => {
                setWrite(event.target.checked);
              }}
            />{' '}
            Write
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <input
              type="checkbox"
              checked={history}
              onChange={(event): void => {
                setHistory(event.target.checked);
              }}
            />{' '}
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
    <main className="notes-settings-page">
      <div className="notes-settings-header">
        <Button
          variant="secondary"
          onClick={handleBack}
          aria-label="Back"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
          <ChevronLeftIcon />
          <span>Back</span>
        </Button>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>
          Account
        </h1>
      </div>

      <section
        className="notes-settings-card"
        aria-labelledby="profile-heading"
      >
        <h2
          id="profile-heading"
          style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}
        >
          Profile
        </h2>
        <p style={{ margin: 0, color: 'var(--notes-text-muted)' }}>
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
        className="notes-settings-card"
        aria-labelledby="signout-heading"
      >
        <h2
          id="signout-heading"
          style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}
        >
          Sign out
        </h2>
        {mustConfirm ? (
          <p
            role="alert"
            style={{ margin: 0, color: 'var(--notes-status-warning-color)' }}
          >
            {String(pendingCount)} change(s) still wait on this device. They
            stay here for recovery; signing out does not upload them.
          </p>
        ) : null}
        {mustConfirm ? (
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <input
              type="checkbox"
              checked={confirmLeave}
              onChange={(event): void => {
                setConfirmLeave(event.target.checked);
              }}
            />{' '}
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
