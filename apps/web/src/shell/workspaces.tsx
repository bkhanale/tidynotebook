/**
 * The workspaces of the account, and the control that moves between them.
 *
 * A workspace is an explicit container that a person chooses (record 0049). It
 * is the scope that every read of the product already has: the note list, the
 * command palette, the search answer, the backlink panel, the Trash and the
 * published links each answer for one workspace, so two workspaces keep two
 * sets of notes apart without a rule in any of those surfaces.
 *
 * The switcher sits at the top of the sidebar, above the New note action, so
 * it reads as the container of everything below it. Create workspace is a
 * pinned row of its menu, so it stays in view as the list grows.
 *
 * The rules of which workspace opens live in `lib/workspace-choice.ts`. The
 * state and the browser storage live in `app.tsx`. This module is the screen.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import {
  createWorkspace,
  deleteWorkspace,
  updateWorkspace,
  type Workspace,
} from '@notesapp/api-client';
import {
  Button,
  ChevronDownIcon,
  Dialog,
  DialogBody,
  DialogFooter,
  LoadingState,
  Menu,
  Page,
  PageHeader,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  WorkspaceIcon,
  type MenuItem,
} from '@notesapp/ui';
import { problemMessage, useWorkspace } from '../app.tsx';
import { isMemberOf, workspaceAfterRemoval } from '../lib/workspace-choice.ts';

/** The longest workspace name the contract accepts. */
const nameLimit = 200;

/**
 * Sends the root address to the notes of the chosen workspace.
 *
 * This screen has no sidebar and no rail: it is only the step between sign-in
 * and the notes of the workspace this device last opened.
 */
export function WorkspaceHome(): ReactNode {
  const { state, reload } = useWorkspace();
  const navigate = useNavigate();

  useEffect(() => {
    if (state.status === 'ready')
      void navigate(`/w/${state.workspaceId}`, { replace: true });
  }, [state, navigate]);

  if (state.status === 'error')
    return (
      <Page>
        <PageHeader title="Your notes did not open" />
        <p className="text-control text-danger" role="alert">
          {state.message}
        </p>
        <Button variant="secondary" onClick={() => reload()}>
          Try again
        </Button>
      </Page>
    );

  return (
    <Page>
      <LoadingState label="Your notes are opening." />
    </Page>
  );
}

/**
 * Opens the workspace that the address names, when the account holds it.
 *
 * An address that names a workspace of this account opens it and becomes the
 * choice of this device, so a link to the second workspace works and a
 * bookmark keeps working. An address that names any other workspace goes to
 * the chosen one, because a person who cannot act on the refusal is better
 * served by their own notes than by an error.
 */
export function RequireCurrentWorkspace({
  workspaceId,
  children,
}: {
  readonly workspaceId: string;
  readonly children: ReactNode;
}): ReactNode {
  const { state, open } = useWorkspace();
  const member =
    state.status === 'ready' && isMemberOf(state.workspaces, workspaceId);

  useEffect(() => {
    if (member) open(workspaceId);
  }, [member, workspaceId, open]);

  if (state.status !== 'ready') return children;
  if (!member) return <Navigate to={`/w/${state.workspaceId}`} replace />;
  return children;
}

/** A labelled name field with its own error line. */
function NameField({
  id,
  label,
  help,
  value,
  error,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly help?: string | undefined;
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}): ReactNode {
  return (
    <div>
      <label
        className="mb-1.5 block text-control font-semibold text-strong"
        htmlFor={id}
      >
        {label}
      </label>
      <input
        id={id}
        className="min-h-11 w-full rounded-lg border border-edge bg-app px-3 py-2 text-ui text-strong outline-none motion-safe:transition-shadow focus:border-focus focus:ring-2 focus:ring-focus/25 md:min-h-9"
        type="text"
        value={value}
        maxLength={nameLimit}
        autoComplete="off"
        aria-invalid={error !== null}
        aria-describedby={error === null ? `${id}-help` : `${id}-error`}
        onChange={(event): void => onChange(event.target.value)}
      />
      {help === undefined ? null : (
        <p className="mb-0 mt-1 text-control text-muted" id={`${id}-help`}>
          {help}
        </p>
      )}
      {error === null ? null : (
        <p
          className="mb-0 mt-1 text-control text-danger"
          id={`${id}-error`}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** What a workspace name has to be before the dialog sends it. */
function nameProblem(name: string, taken: readonly string[]): string | null {
  if (name === '') return 'Give the workspace a name.';
  if (name.length > nameLimit)
    return `A workspace name can have up to ${String(nameLimit)} characters.`;
  if (taken.some((one) => one.toLowerCase() === name.toLowerCase()))
    return `A workspace named ${name} already exists.`;
  return null;
}

/**
 * Makes a workspace and opens it.
 *
 * The new workspace starts empty, so the person lands on the empty state of
 * the note list and the one action that fills it.
 */
function NewWorkspaceDialog({
  open,
  onClose,
  workspaces,
  onCreated,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly workspaces: readonly Workspace[];
  readonly onCreated: (workspaceId: string) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setError(null);
    setSaving(false);
  }, [open]);

  const create = (): void => {
    if (saving) return;
    const wanted = name.trim();
    const problem = nameProblem(
      wanted,
      workspaces.map((workspace) => workspace.name),
    );
    if (problem !== null) {
      setError(problem);
      return;
    }
    setSaving(true);
    void (async (): Promise<void> => {
      const result = await createWorkspace({ body: { name: wanted } });
      setSaving(false);
      if (result.error !== undefined || result.data === undefined) {
        setError(problemMessage(result.error));
        return;
      }
      onCreated(result.data.workspaceId);
      onClose();
    })();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New workspace"
      titleId="new-workspace-title"
      width="small"
    >
      <form
        onSubmit={(event): void => {
          event.preventDefault();
          create();
        }}
      >
        <DialogBody>
          <NameField
            id="new-workspace-name"
            label="Workspace name"
            help="The workspace starts empty and keeps its notes apart from every other workspace."
            value={name}
            error={error}
            onChange={(value) => {
              setName(value);
              setError(null);
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            Make workspace
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** Renames the open workspace. */
function RenameWorkspaceDialog({
  open,
  onClose,
  workspace,
  workspaces,
  onRenamed,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly workspace: Workspace;
  readonly workspaces: readonly Workspace[];
  readonly onRenamed: () => void;
}): ReactNode {
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(workspace.name);
    setError(null);
    setSaving(false);
  }, [open, workspace.name]);

  const rename = (): void => {
    if (saving) return;
    const wanted = name.trim();
    if (wanted === workspace.name) {
      onClose();
      return;
    }
    const problem = nameProblem(
      wanted,
      workspaces
        .filter((one) => one.workspaceId !== workspace.workspaceId)
        .map((one) => one.name),
    );
    if (problem !== null) {
      setError(problem);
      return;
    }
    setSaving(true);
    void (async (): Promise<void> => {
      const result = await updateWorkspace({
        path: { workspaceId: workspace.workspaceId },
        body: { name: wanted },
      });
      setSaving(false);
      if (result.error !== undefined) {
        setError(problemMessage(result.error));
        return;
      }
      onRenamed();
      onClose();
    })();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rename workspace"
      titleId="rename-workspace-title"
      width="small"
    >
      <form
        onSubmit={(event): void => {
          event.preventDefault();
          rename();
        }}
      >
        <DialogBody>
          <NameField
            id="rename-workspace-name"
            label="Workspace name"
            help="The notes of the workspace do not change."
            value={name}
            error={error}
            onChange={(value) => {
              setName(value);
              setError(null);
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            Rename workspace
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * Deletes the open workspace and everything in it.
 *
 * The step is not reversible and there is no Trash above a workspace, so the
 * dialog states what goes and asks the person to confirm the name. The server
 * refuses the last workspace of an account whatever this screen shows
 * (record 0051).
 */
function DeleteWorkspaceDialog({
  open,
  onClose,
  workspace,
  onDeleted,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly workspace: Workspace;
  readonly onDeleted: () => void;
}): ReactNode {
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmation('');
    setError(null);
    setDeleting(false);
  }, [open]);

  const matches = confirmation.trim() === workspace.name;

  const remove = (): void => {
    if (deleting || !matches) return;
    setDeleting(true);
    void (async (): Promise<void> => {
      const result = await deleteWorkspace({
        path: { workspaceId: workspace.workspaceId },
      });
      setDeleting(false);
      if (result.error !== undefined) {
        setError(problemMessage(result.error));
        return;
      }
      onDeleted();
      onClose();
    })();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete workspace permanently"
      titleId="delete-workspace-title"
      width="small"
    >
      <form
        onSubmit={(event): void => {
          event.preventDefault();
          remove();
        }}
      >
        <DialogBody>
          <p className="mb-4 mt-0 text-ui text-strong">
            Every note, version and published link of {workspace.name} goes. You
            cannot get them back.
          </p>
          <NameField
            id="delete-workspace-name"
            label={`Type ${workspace.name} to confirm`}
            value={confirmation}
            error={error}
            onChange={(value) => {
              setConfirmation(value);
              setError(null);
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            type="submit"
            disabled={deleting || !matches}
          >
            Delete permanently
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * The workspace switcher of the sidebar.
 *
 * The trigger names the open workspace. The menu lists every workspace of the
 * account and marks the open one, then the actions of that workspace, then the
 * pinned Create workspace row.
 */
export function WorkspaceSwitcher({
  onNavigate,
}: {
  /** Closes the navigation drawer after a switch on a narrow viewport. */
  readonly onNavigate: () => void;
}): ReactNode {
  const { state, open, reload } = useWorkspace();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The workspace to open once the list has been read again. A create and a
  // delete both change the list, so the move waits for the answer that holds
  // the workspace it moves to.
  const pendingOpen = useRef<string | null>(null);

  const workspaces = state.status === 'ready' ? state.workspaces : [];
  const openWorkspace =
    state.status === 'ready'
      ? (workspaces.find(
          (workspace) => workspace.workspaceId === state.workspaceId,
        ) ?? null)
      : null;

  useEffect(() => {
    const wanted = pendingOpen.current;
    if (wanted === null || state.status !== 'ready') return;
    if (!isMemberOf(workspaces, wanted)) return;
    pendingOpen.current = null;
    open(wanted);
    void navigate(`/w/${wanted}`);
  }, [state.status, workspaces, open, navigate]);

  if (state.status !== 'ready' || openWorkspace === null) return null;

  const switchTo = (workspaceId: string): void => {
    if (workspaceId === state.workspaceId) return;
    open(workspaceId);
    void navigate(`/w/${workspaceId}`);
    onNavigate();
  };

  const items: MenuItem[] = workspaces.map((workspace) => ({
    id: workspace.workspaceId,
    label: workspace.name,
    selected: workspace.workspaceId === state.workspaceId,
    onSelect: () => switchTo(workspace.workspaceId),
  }));

  const pinned: MenuItem[] = [
    {
      id: 'rename-workspace',
      label: 'Rename workspace',
      icon: <PencilIcon size={14} />,
      onSelect: () => setRenaming(true),
    },
    // Record 0051 keeps the last workspace of an account, so the row is absent
    // rather than present and always refused. The server refuses it either
    // way; this is only the courtesy.
    ...(workspaces.length > 1
      ? [
          {
            id: 'delete-workspace',
            label: 'Delete permanently',
            icon: <TrashIcon size={14} />,
            danger: true,
            onSelect: (): void => setDeleting(true),
          },
        ]
      : []),
    {
      id: 'new-workspace',
      label: 'New workspace',
      icon: <PlusIcon size={14} />,
      onSelect: () => setCreating(true),
    },
  ];

  return (
    <div className="border-b border-edge-subtle p-2">
      <Menu
        label={`Workspace: ${openWorkspace.name}`}
        items={items}
        pinned={pinned}
        align="start"
        triggerClassName="flex min-h-11 w-full cursor-pointer items-center gap-cluster rounded-lg border border-edge bg-app px-2 text-left text-control text-strong motion-safe:transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-9"
      >
        <span
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-fill text-on-accent"
          aria-hidden="true"
        >
          <WorkspaceIcon size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">
          {openWorkspace.name}
        </span>
        <span
          className="inline-flex shrink-0 items-center text-muted"
          aria-hidden="true"
        >
          <ChevronDownIcon size={14} />
        </span>
      </Menu>

      <NewWorkspaceDialog
        open={creating}
        onClose={() => setCreating(false)}
        workspaces={workspaces}
        onCreated={(workspaceId) => {
          pendingOpen.current = workspaceId;
          reload();
          onNavigate();
        }}
      />
      <RenameWorkspaceDialog
        open={renaming}
        onClose={() => setRenaming(false)}
        workspace={openWorkspace}
        workspaces={workspaces}
        onRenamed={reload}
      />
      <DeleteWorkspaceDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        workspace={openWorkspace}
        onDeleted={() => {
          const next = workspaceAfterRemoval(workspaces, state.workspaceId);
          if (next !== null) pendingOpen.current = next.workspaceId;
          reload();
          onNavigate();
        }}
      />
    </div>
  );
}
