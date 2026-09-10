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
    return 'Use a note name without empty folders, traversal, or edge spaces.';
  return `This note name is refused: ${result.error.code}.`;
}

/** Redirects the signed-in account to its last or personal workspace. */
export function WorkspaceHome(): ReactNode {
  const { state, reload } = useWorkspaces();
  const navigate = useNavigate();

  useEffect(() => {
    if (state.status === 'ready' && state.workspaces.length > 0) {
      const lastId = window.localStorage.getItem('notesapp:last-workspace-id');
      const remembered = state.workspaces.find(
        (workspace) => workspace.workspaceId === lastId,
      );
      const target =
        remembered ??
        state.workspaces.find((workspace) => workspace.personal) ??
        state.workspaces[0];
      if (target !== undefined)
        void navigate(`/w/${target.workspaceId}`, { replace: true });
    }
  }, [state, navigate]);

  if (state.status === 'loading')
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <StatusRegion message="Loading workspaces." />
      </main>
    );
  if (state.status === 'error')
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Workspaces
        </h1>
        <p className="text-control text-danger" role="alert">
          {state.message}
        </p>
        <Button variant="secondary" onClick={() => reload()}>
          Retry
        </Button>
      </main>
    );

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <StatusRegion message="Opening your workspace." />
    </main>
  );
}

/** Creates an additional workspace from the workspace switcher. */
export function WorkspaceCreateView(): ReactNode {
  const { reload } = useWorkspaces();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(): Promise<void> {
    setBusy(true);
    setError('');
    const result = await createWorkspace({ body: { name: name.trim() } });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      setError(problemMessage(result.error));
      return;
    }
    window.localStorage.setItem(
      'notesapp:last-workspace-id',
      result.data.workspaceId,
    );
    reload();
    await navigate(`/w/${result.data.workspaceId}`, { replace: true });
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-edge px-3 text-control text-strong no-underline hover:bg-hover"
        >
          <ChevronLeftIcon size={16} />
          <span>Back</span>
        </Link>
        <h1 className="m-0 text-xl font-semibold text-strong">
          Create workspace
        </h1>
      </div>
      <section className="rounded-xl border border-edge-subtle bg-card p-5 shadow-sm">
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
            placeholder="Project notes"
            onChange={setName}
          />
          {error === '' ? null : (
            <p className="text-control text-danger" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            icon={<PlusIcon size={16} />}
            disabled={busy || name.trim() === ''}
          >
            {busy ? 'Creating.' : 'Create workspace'}
          </Button>
        </form>
      </section>
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
    <section className="space-y-4" aria-labelledby="owner-heading">
      <h2
        className="m-0 text-base font-semibold text-strong"
        id="owner-heading"
      >
        Owner controls
      </h2>
      {error !== '' ? (
        <p className="text-control text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {notice !== '' ? (
        <p className="text-control text-success" role="status">
          {notice}
        </p>
      ) : null}
      <h3 className="m-0 text-ui font-semibold text-strong">Rename</h3>
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
      <h3 className="m-0 text-ui font-semibold text-strong">
        Delete workspace
      </h3>
      <label className="flex items-center gap-2 text-control text-strong">
        <input
          type="checkbox"
          checked={confirmDelete}
          onChange={(event): void => {
            setConfirmDelete(event.target.checked);
          }}
        />
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
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Workspace not found
        </h1>
        <p>The address names no workspace.</p>
      </main>
    );
  }

  if (state.status === 'loading') {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <StatusRegion message="Loading workspace settings." />
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Workspace
        </h1>
        <p className="text-control text-danger" role="alert">
          {state.message}
        </p>
      </main>
    );
  }

  const workspace = findWorkspace(state.workspaces, workspaceId);
  if (workspace === null) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Workspace not found
        </h1>
        <p>This account has no workspace with that ID.</p>
        <p>
          <Link to="/">Back to workspaces.</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link
          to={`/w/${workspaceId}`}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-edge px-3 text-control text-strong no-underline hover:bg-hover"
        >
          <ChevronLeftIcon size={14} />
          <span>Back to notes</span>
        </Link>
        <h1 className="m-0 text-xl font-semibold text-strong">
          {workspace.name} Settings
        </h1>
      </div>

      <section
        className="space-y-3 rounded-xl border border-edge-subtle bg-card p-5 shadow-sm"
        aria-labelledby="workspace-info-heading"
      >
        <h2
          className="m-0 text-base font-semibold text-strong"
          id="workspace-info-heading"
        >
          General
        </h2>
        <div className="flex items-center gap-2">
          <Badge variant={workspace.role === 'owner' ? 'accent' : 'default'}>
            Role: {workspace.role}
          </Badge>
          {workspace.personal ? (
            <Badge variant="default">Personal</Badge>
          ) : null}
        </div>
      </section>

      {workspace.role === 'owner' ? (
        <section className="rounded-xl border border-edge-subtle bg-card p-5 shadow-sm">
          <WorkspaceOwnerControls workspace={workspace} onChanged={reload} />
        </section>
      ) : null}

      <section
        className="space-y-3 rounded-xl border border-edge-subtle bg-card p-5 shadow-sm"
        aria-labelledby="advanced-heading"
      >
        <h2
          className="m-0 text-base font-semibold text-strong"
          id="advanced-heading"
        >
          Advanced
        </h2>
        <div className="flex flex-wrap gap-4 text-control">
          <Link className="text-accent" to={`/w/${workspaceId}/purge`}>
            Deletion and purge
          </Link>
          <Link className="text-accent" to={`/w/${workspaceId}/recovery`}>
            Access and recovery
          </Link>
        </div>
      </section>
    </main>
  );
}
