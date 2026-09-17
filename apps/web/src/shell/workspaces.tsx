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
import { useEffect, useState, type ReactNode } from 'react';
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
  type MenuItem,
  Page,
  PageHeader,
  PencilIcon,
  PlusIcon,
  transitionField,
  transitionSurface,
  TrashIcon,
  WorkspaceIcon,
} from '@notesapp/ui';
import { problemMessage, useWorkspace } from '../app.tsx';
import { isMemberOf } from '../lib/workspace-choice.ts';

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
 * The address is the one thing that says which workspace is open, and this is
 * the one place that records it as the choice of this device. Every other
 * screen navigates and lets this decide.
 *
 * A workspace the list does not hold is not yet a refusal. The list is a cache
 * of a server fact and it goes stale, so the address is worth one question to
 * the server: another device may have made that workspace. The redirect waits
 * for the answer to that question and not merely for the asking, which is what
 * `revision` is for. A workspace that is still unknown after the answer sends
 * the person to the one they chose, because a refusal they cannot act on is
 * worse than their own notes.
 */
export function RequireCurrentWorkspace({
  workspaceId,
  children,
}: {
  readonly workspaceId: string;
  readonly children: ReactNode;
}): ReactNode {
  const { state, remember, reload } = useWorkspace();
  /** The address that was asked about, and the list revision at that moment. */
  const [asked, setAsked] = useState<{
    readonly workspaceId: string;
    readonly revision: number;
  } | null>(null);

  const ready = state.status === 'ready';
  const member = ready && isMemberOf(state.workspaces, workspaceId);
  const revision = ready ? state.revision : 0;

  useEffect(() => {
    if (!ready || member) {
      if (member) remember(workspaceId);
      return;
    }
    if (asked?.workspaceId === workspaceId) return;
    setAsked({ workspaceId, revision });
    reload();
  }, [ready, member, workspaceId, revision, asked, remember, reload]);

  if (!ready) return children;
  if (member) return children;
  // The question is still out. Nothing is decided, so nothing moves.
  if (asked?.workspaceId !== workspaceId || revision <= asked.revision)
    return children;
  return <Navigate to={`/w/${state.workspaceId}`} replace />;
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
        className={`min-h-11 w-full rounded-lg border border-edge bg-app px-3 py-2 text-ui text-strong outline-none ${transitionField} focus:border-focus focus:ring-2 focus:ring-focus/25 md:min-h-9`}
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
export function NewWorkspaceDialog({
  open,
  onClose,
  workspaces,
  onCreated,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly workspaces: readonly Workspace[];
  readonly onCreated: (workspace: Workspace) => void;
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
      onCreated(result.data);
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
export function RenameWorkspaceDialog({
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
export function DeleteWorkspaceDialog({
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
 *
 * The dialogs of those actions do not live here. The sidebar is a transformed
 * element, because the drawer slides, and a transform makes its box the
 * containing block of every `position: fixed` descendant. A dialog rendered
 * inside it would be trapped in the width of the sidebar instead of covering
 * the page. So this control raises intent and `shell.tsx` owns the dialogs,
 * which is what it already does for the folder and publish dialogs.
 */
export function WorkspaceSwitcher({
  workspaceId,
  onNavigate,
  onCreate,
  onRename,
  onDelete,
}: {
  /**
   * The workspace of the address, which is the one the shell is showing.
   *
   * The trigger names this and not the stored choice, because the address is
   * what every other part of the shell is scoped to. Reading one fact from
   * one place keeps the name and the notes below it in step.
   */
  readonly workspaceId: string;
  /** Closes the navigation drawer after a switch on a narrow viewport. */
  readonly onNavigate: () => void;
  readonly onCreate: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}): ReactNode {
  const { state } = useWorkspace();
  const navigate = useNavigate();

  const workspaces = state.status === 'ready' ? state.workspaces : [];
  const openWorkspace =
    workspaces.find((workspace) => workspace.workspaceId === workspaceId) ??
    null;

  if (state.status !== 'ready' || openWorkspace === null) return null;

  const switchTo = (wanted: string): void => {
    if (wanted === workspaceId) return;
    // Only the address moves. The membership check of the route records the
    // choice, so nothing else writes it.
    void navigate(`/w/${wanted}`);
    onNavigate();
  };

  const items: MenuItem[] = workspaces.map((workspace) => ({
    id: workspace.workspaceId,
    label: workspace.name,
    selected: workspace.workspaceId === workspaceId,
    onSelect: () => switchTo(workspace.workspaceId),
  }));

  const pinned: MenuItem[] = [
    {
      id: 'rename-workspace',
      label: 'Rename workspace',
      icon: <PencilIcon size={14} />,
      onSelect: onRename,
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
            onSelect: onDelete,
          },
        ]
      : []),
    {
      id: 'new-workspace',
      label: 'New workspace',
      icon: <PlusIcon size={14} />,
      onSelect: onCreate,
    },
  ];

  return (
    <div className="border-b border-edge-line p-2">
      <Menu
        label={`Workspace: ${openWorkspace.name}`}
        items={items}
        pinned={pinned}
        matchTrigger
        triggerClassName={`flex min-h-11 w-full cursor-pointer items-center gap-cluster rounded-lg border border-edge bg-app px-2 py-1.5 text-left text-control text-strong ${transitionSurface} hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-9`}
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
    </div>
  );
}
