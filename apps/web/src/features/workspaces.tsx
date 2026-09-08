/**
 * Workspace screens: selection, creation, and settings.
 *
 * Every action calls a generated workspace operation. The screens show the
 * current role. Owner-only deletion uses an explicit role check.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
  type Role,
  type Workspace,
} from '@notesapp/api-client';
import { normalizePath } from '@notesapp/core';
import {
  Badge,
  Button,
  ChevronLeftIcon,
  PlusIcon,
  StatusRegion,
  TextField,
  WorkspaceIcon,
} from '@notesapp/ui';
import { problemMessage, useSession } from '../app.tsx';

/** The loaded workspaces with their load state. */
export type WorkspacesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly workspaces: readonly Workspace[] };

const workspaceCachePrefix = 'notesapp.cached-workspaces:';

function cachedRole(value: unknown): Role | null {
  if (
    value === 'owner' ||
    value === 'admin' ||
    value === 'editor' ||
    value === 'viewer'
  )
    return value;
  return null;
}

function cachedWorkspaces(accountId: string): readonly Workspace[] | null {
  try {
    const source = window.localStorage.getItem(
      `${workspaceCachePrefix}${accountId}`,
    );
    if (source === null) return null;
    const value: unknown = JSON.parse(source);
    if (!Array.isArray(value)) return null;
    const workspaces: Workspace[] = [];
    for (const item of value) {
      if (item === null || typeof item !== 'object') return null;
      const row: Record<string, unknown> = Object.fromEntries(
        Object.entries(item),
      );
      const role = cachedRole(row['role']);
      if (
        typeof row['workspaceId'] !== 'string' ||
        typeof row['name'] !== 'string' ||
        role === null ||
        typeof row['personal'] !== 'boolean'
      )
        return null;
      workspaces.push({
        workspaceId: row['workspaceId'],
        name: row['name'],
        role,
        personal: row['personal'],
      });
    }
    return workspaces;
  } catch {
    return null;
  }
}

function rememberWorkspaces(
  accountId: string,
  workspaces: readonly Workspace[],
): void {
  try {
    window.localStorage.setItem(
      `${workspaceCachePrefix}${accountId}`,
      JSON.stringify(workspaces),
    );
  } catch {
    // The live workspace list remains usable when cache storage fails.
  }
}

/** Loads every workspace of the signed-in account. */
export function useWorkspaces(): {
  readonly state: WorkspacesState;
  readonly reload: () => void;
} {
  const session = useSession();
  const [state, setState] = useState<WorkspacesState>({ status: 'loading' });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (session.status !== 'signed-in') {
      setState({ status: 'loading' });
      return;
    }
    let cancelled = false;
    async function load(): Promise<void> {
      setState({ status: 'loading' });
      const result = await listWorkspaces();
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        const responseStatus = result.response?.status ?? 0;
        const cached = cachedWorkspaces(session.account?.accountId ?? '');
        if (cached !== null && (responseStatus === 0 || responseStatus >= 500))
          setState({ status: 'ready', workspaces: cached });
        else
          setState({ status: 'error', message: problemMessage(result.error) });
      } else {
        if (session.account !== null)
          rememberWorkspaces(session.account.accountId, result.data.workspaces);
        setState({ status: 'ready', workspaces: result.data.workspaces });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [session.status, session.account, generation]);

  return {
    state,
    reload: () => {
      setGeneration((current) => current + 1);
    },
  };
}

/** Finds one workspace by ID in a loaded list. */
export function findWorkspace(
  workspaces: readonly Workspace[],
  workspaceId: string,
): Workspace | null {
  for (const entry of workspaces) {
    if (entry.workspaceId === workspaceId) return entry;
  }
  return null;
}

/** True when the role may change files. */
export function canWrite(role: Role): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

/** Validates a new note path with the shared domain rule. */
export function validateNotePath(input: string): string | null {
  const result = normalizePath(input);
  if (result.ok) return null;
  if (result.error.code === 'invalid_path')
    return 'Use a relative .md path without traversal, for example notes/today.md.';
  return `This path is refused: ${result.error.code}.`;
}

/** Workspace home: the list and creation form for writers. */
export function WorkspaceHome(): ReactNode {
  const { state, reload } = useWorkspaces();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === 'ready' && state.workspaces.length > 0) {
      const lastId = window.localStorage.getItem('notesapp:last-workspace-id');
      if (
        lastId !== null &&
        state.workspaces.some((w) => w.workspaceId === lastId)
      ) {
        void navigate(`/w/${lastId}`, { replace: true });
      }
    }
  }, [state, navigate]);

  async function create(): Promise<void> {
    setBusy(true);
    setError('');
    const result = await createWorkspace({ body: { name } });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      setError(problemMessage(result.error));
      return;
    }
    setName('');
    reload();
  }

  if (state.status === 'loading')
    return (
      <main>
        <StatusRegion message="Loading workspaces." />
      </main>
    );
  if (state.status === 'error')
    return (
      <main>
        <h1>Workspaces</h1>
        <p className="notes-status-error" role="alert">
          {state.message}
        </p>
        <Button variant="secondary" onClick={() => reload()}>
          Retry
        </Button>
      </main>
    );

  return (
    <main>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 6px 0' }}>Workspaces</h1>
        <p
          style={{
            margin: 0,
            color: 'var(--notes-text-muted)',
            fontSize: '0.9rem',
          }}
        >
          Select a workspace to open your notes.
        </p>
      </div>

      <ul className="notes-workspaces-grid">
        {state.workspaces.map((entry) => (
          <li key={entry.workspaceId} style={{ listStyle: 'none' }}>
            <Link
              to={`/w/${entry.workspaceId}`}
              className="notes-workspace-card"
              onClick={() => {
                window.localStorage.setItem(
                  'notesapp:last-workspace-id',
                  entry.workspaceId,
                );
              }}
            >
              <div className="notes-workspace-card-header">
                <div className="notes-workspace-card-title">
                  <span className="notes-tree-icon" aria-hidden="true">
                    <WorkspaceIcon size={18} />
                  </span>
                  <span>{entry.name}</span>
                </div>
                <Badge variant={entry.role === 'owner' ? 'accent' : 'default'}>
                  {entry.role}
                </Badge>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 'auto',
                  paddingTop: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--notes-text-muted)',
                  }}
                >
                  {entry.personal ? 'Personal' : 'Team'}
                </span>
                <span
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--notes-accent-text)',
                    fontWeight: 500,
                  }}
                >
                  Open →
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {state.workspaces.length === 0 ? (
        <p className="notes-status-region">
          No workspace yet. Create the first one below.
        </p>
      ) : null}

      <div className="notes-card" style={{ marginTop: '32px' }}>
        <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '1.15rem' }}>
          Create a workspace
        </h2>
        <form
          onSubmit={(event): void => {
            event.preventDefault();
            void create();
          }}
        >
          <TextField
            id="workspace-name"
            label="Workspace name"
            value={name}
            required
            placeholder="e.g. Personal Notes, Engineering"
            onChange={setName}
          />
          {error !== '' ? (
            <p className="notes-status-error" role="alert">
              {error}
            </p>
          ) : null}
          <div style={{ marginTop: '14px' }}>
            <Button
              type="submit"
              icon={<PlusIcon size={16} />}
              disabled={busy || name.trim() === ''}
            >
              {busy ? 'Creating.' : 'Create workspace'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}

/** Owner controls: rename and delete. */
export function WorkspaceOwnerControls({
  workspace,
  onChanged,
}: {
  readonly workspace: Workspace;
  readonly onChanged: () => void;
}): ReactNode {
  const [name, setName] = useState(workspace.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function rename(): Promise<void> {
    setError('');
    setNotice('');
    const result = await updateWorkspace({
      path: { workspaceId: workspace.workspaceId },
      body: { name },
    });
    if (result.error !== undefined || result.data === undefined) {
      setError(problemMessage(result.error));
      return;
    }
    setNotice('The workspace name is saved.');
    onChanged();
  }

  async function remove(): Promise<void> {
    setError('');
    setNotice('');
    const result = await deleteWorkspace({
      path: { workspaceId: workspace.workspaceId },
    });
    if (result.error !== undefined) {
      setError(problemMessage(result.error));
      return;
    }
    setNotice('The workspace is deleted.');
    onChanged();
  }

  return (
    <section aria-labelledby="owner-heading">
      <h2 id="owner-heading">Owner controls</h2>
      {error !== '' ? (
        <p className="notes-status-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice !== '' ? (
        <p className="notes-status-ok" role="status">
          {notice}
        </p>
      ) : null}
      <h3>Rename</h3>
      <form
        onSubmit={(event): void => {
          event.preventDefault();
          void rename();
        }}
      >
        <TextField
          id="owner-name"
          label="Workspace name"
          value={name}
          required
          onChange={setName}
        />
        <Button type="submit">Save name</Button>
      </form>
      <h3>Delete workspace</h3>
      <label>
        <input
          type="checkbox"
          checked={confirmDelete}
          onChange={(event): void => {
            setConfirmDelete(event.target.checked);
          }}
        />{' '}
        I understand this deletes the workspace and its files.
      </label>
      <Button
        variant="danger"
        disabled={!confirmDelete}
        onClick={() => void remove()}
      >
        Delete this workspace
      </Button>
    </section>
  );
}

/** Dedicated workspace settings screen. */
export function WorkspaceSettingsView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const { state, reload } = useWorkspaces();

  if (workspaceId === null) {
    return (
      <main className="notes-settings-page">
        <h1>Workspace not found</h1>
        <p>The address names no workspace.</p>
      </main>
    );
  }

  if (state.status === 'loading') {
    return (
      <main className="notes-settings-page">
        <StatusRegion message="Loading workspace settings." />
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="notes-settings-page">
        <h1>Workspace</h1>
        <p className="notes-status-error" role="alert">
          {state.message}
        </p>
      </main>
    );
  }

  const workspace = findWorkspace(state.workspaces, workspaceId);
  if (workspace === null) {
    return (
      <main className="notes-settings-page">
        <h1>Workspace not found</h1>
        <p>This account has no workspace with that ID.</p>
        <p>
          <Link to="/">Back to workspaces.</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="notes-settings-page">
      <div className="notes-settings-header">
        <Link
          to={`/w/${workspaceId}`}
          className="notes-btn notes-btn-secondary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            textDecoration: 'none',
          }}
        >
          <ChevronLeftIcon />
          <span>Back to notes</span>
        </Link>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>
          {workspace.name} Settings
        </h1>
      </div>

      <section
        className="notes-settings-card"
        aria-labelledby="workspace-info-heading"
      >
        <h2
          id="workspace-info-heading"
          style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}
        >
          General
        </h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Badge variant={workspace.role === 'owner' ? 'accent' : 'default'}>
            Role: {workspace.role}
          </Badge>
          {workspace.personal ? (
            <Badge variant="default">Personal</Badge>
          ) : null}
        </div>
      </section>

      {workspace.role === 'owner' ? (
        <section className="notes-settings-card">
          <WorkspaceOwnerControls workspace={workspace} onChanged={reload} />
        </section>
      ) : null}

      <section
        className="notes-settings-card"
        aria-labelledby="advanced-heading"
      >
        <h2
          id="advanced-heading"
          style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}
        >
          Advanced
        </h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <Link to={`/w/${workspaceId}/purge`}>Deletion and purge</Link>
          <Link to={`/w/${workspaceId}/recovery`}>Access and recovery</Link>
        </div>
      </section>
    </main>
  );
}
