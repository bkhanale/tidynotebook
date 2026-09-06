/**
 * Workspace screens: selection, creation, settings, and membership.
 *
 * Every action calls a generated workspace operation. The screens show the
 * current role: viewers get a read-only note instead of disabled-looking
 * forms that hide why. Owner-only transfer and deletion live behind an
 * explicit role check of the loaded membership.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  createWorkspace,
  deleteWorkspace,
  inviteMember,
  listMembers,
  listWorkspaces,
  removeMember,
  transferOwnership,
  updateMember,
  updateWorkspace,
  type AssignableRole,
  type Invitation,
  type Member,
  type Role,
  type Workspace,
} from '@notesapp/api-client';
import { normalizePath } from '@notesapp/core';
import {
  Badge,
  Button,
  PlusIcon,
  SelectField,
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
      if (result.error !== undefined || result.data === undefined)
        setState({ status: 'error', message: problemMessage(result.error) });
      else setState({ status: 'ready', workspaces: result.data.workspaces });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [session.status, generation]);

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

/** True when the role may manage membership. */
export function canManageMembers(role: Role): boolean {
  return role === 'owner' || role === 'admin';
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
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
          Select an active workspace to open your notes or manage workspace
          members.
        </p>
      </div>

      <ul className="notes-workspaces-grid">
        {state.workspaces.map((entry) => (
          <li key={entry.workspaceId} style={{ listStyle: 'none' }}>
            <Link
              to={`/w/${entry.workspaceId}`}
              className="notes-workspace-card"
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

const assignableRoles: readonly AssignableRole[] = [
  'admin',
  'editor',
  'viewer',
];

/** Membership list, invitations, role changes, and removal. */
export function WorkspaceMembers({
  workspaceId,
  role,
  onChanged,
}: {
  readonly workspaceId: string;
  readonly role: Role;
  readonly onChanged: () => void;
}): ReactNode {
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [invitations, setInvitations] = useState<readonly Invitation[]>([]);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AssignableRole>('editor');
  const [busy, setBusy] = useState(false);
  const managers = canManageMembers(role);

  async function load(): Promise<void> {
    const result = await listMembers({ path: { workspaceId } });
    if (result.error !== undefined || result.data === undefined) {
      setError(problemMessage(result.error));
      return;
    }
    setMembers(result.data.members);
    setInvitations(result.data.invitations);
  }

  useEffect(() => {
    void load();
  }, [workspaceId]);

  async function invite(): Promise<void> {
    setBusy(true);
    setError('');
    const result = await inviteMember({
      path: { workspaceId },
      body: { email, role: inviteRole },
    });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      setError(problemMessage(result.error));
      return;
    }
    setEmail('');
    await load();
    onChanged();
  }

  async function changeRole(
    accountId: string,
    next: AssignableRole,
  ): Promise<void> {
    setError('');
    const result = await updateMember({
      path: { workspaceId, accountId },
      body: { role: next },
    });
    if (result.error !== undefined) {
      setError(problemMessage(result.error));
      return;
    }
    await load();
    onChanged();
  }

  async function remove(accountId: string): Promise<void> {
    setError('');
    const result = await removeMember({ path: { workspaceId, accountId } });
    if (result.error !== undefined) {
      setError(problemMessage(result.error));
      return;
    }
    await load();
    onChanged();
  }

  return (
    <section aria-labelledby="members-heading">
      <h2 id="members-heading">Members</h2>
      {error !== '' ? (
        <p className="notes-status-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul>
        {members.map((member) => (
          <li key={member.accountId}>
            {member.email ?? member.accountId} ({member.role})
            {managers && member.role !== 'owner' ? (
              <>
                {' '}
                <SelectField
                  id={`role-${member.accountId}`}
                  label={`Role of ${member.email ?? member.accountId}`}
                  value={member.role}
                  options={assignableRoles.map((entry) => ({
                    value: entry,
                    label: entry,
                  }))}
                  onChange={(value): void => {
                    if (
                      value === 'admin' ||
                      value === 'editor' ||
                      value === 'viewer'
                    )
                      void changeRole(member.accountId, value);
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => void remove(member.accountId)}
                >
                  Remove
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {managers ? (
        <>
          <h3>Invite a member</h3>
          <form
            onSubmit={(event): void => {
              event.preventDefault();
              void invite();
            }}
          >
            <TextField
              id="invite-email"
              label="Address"
              value={email}
              inputType="email"
              autoComplete="email"
              required
              onChange={setEmail}
            />
            <SelectField
              id="invite-role"
              label="Role"
              value={inviteRole}
              options={assignableRoles.map((entry) => ({
                value: entry,
                label: entry,
              }))}
              onChange={(value): void => {
                if (
                  value === 'admin' ||
                  value === 'editor' ||
                  value === 'viewer'
                )
                  setInviteRole(value);
              }}
            />
            <Button type="submit" disabled={busy || email === ''}>
              {busy ? 'Inviting.' : 'Send invitation'}
            </Button>
          </form>
          {invitations.length > 0 ? (
            <>
              <h3>Open invitations</h3>
              <ul>
                {invitations.map((invitation) => (
                  <li key={invitation.id}>
                    {invitation.email} ({invitation.role}, {invitation.state})
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : (
        <p>Only administrators and the owner manage membership.</p>
      )}
    </section>
  );
}

/** Owner controls: rename, transfer ownership, and delete. */
export function WorkspaceOwnerControls({
  workspace,
  onChanged,
}: {
  readonly workspace: Workspace;
  readonly onChanged: () => void;
}): ReactNode {
  const [name, setName] = useState(workspace.name);
  const [ownerId, setOwnerId] = useState('');
  const [ownerLeaves, setOwnerLeaves] = useState(false);
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

  async function transfer(): Promise<void> {
    setError('');
    setNotice('');
    const result = await transferOwnership({
      path: { workspaceId: workspace.workspaceId },
      body: ownerLeaves
        ? { accountId: ownerId, leave: true }
        : { accountId: ownerId },
    });
    if (result.error !== undefined) {
      setError(problemMessage(result.error));
      return;
    }
    setOwnerId('');
    setNotice('Ownership moved to the new owner.');
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
      <h3>Transfer ownership</h3>
      <TextField
        id="owner-id"
        label="Account ID of the new owner"
        value={ownerId}
        required
        onChange={setOwnerId}
      />
      <label>
        <input
          type="checkbox"
          checked={ownerLeaves}
          onChange={(event): void => {
            setOwnerLeaves(event.target.checked);
          }}
        />{' '}
        Leave the workspace after the transfer
      </label>
      <Button
        variant="secondary"
        disabled={ownerId.trim() === ''}
        onClick={() => void transfer()}
      >
        Transfer ownership
      </Button>
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
