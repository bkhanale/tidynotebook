/**
 * The application shell: one frame for every signed in screen.
 *
 * The header is one row of 48 px with three zones. Left: the drawer toggle
 * below `md`, then the product mark. Centre: one search affordance that
 * opens the command palette at every width. Right: the save and sync chip,
 * then one overflow menu. The sidebar is 256 px, holds the only primary
 * action of the shell, the notes that changed last, the folder tree, and a
 * quiet footer. Every route below owns exactly one `main` landmark.
 *
 * The one workspace of the account is an implicit container. It stays in
 * the address so a note keeps a stable link, but nothing on screen names
 * it.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
import {
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  ComputerIcon,
  EmptyState,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  Menu,
  MenuIcon,
  MoonIcon,
  MoreIcon,
  CloseIcon,
  Notice,
  Page,
  PageHeader,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StatusRegion,
  SunIcon,
  TrashIcon,
  WorkspaceIcon,
  type MenuItem,
} from '@notesapp/ui';
import {
  SyncProvider,
  useLocalStore,
  useRequestSync,
  useSession,
  useSyncState,
  useTheme,
  useWorkspaceSync,
} from '../app.tsx';
import { AttentionLink, useAttentionCount } from './attention-link.tsx';
import { CommandPalette } from './command-palette.tsx';
import { useDocumentTitle } from './document-title.ts';
import { FilesProvider, useFiles, useOpenFolders } from './files.tsx';
import {
  MoveNoteDialog,
  NewFolderDialog,
  RenameFolderDialog,
} from './folders.tsx';
import { NewNoteButton, useCreateNote } from './new-note.tsx';
import { NoteActionsScope, useNoteActions } from './note-actions.tsx';
import {
  buildNoteTree,
  notesInFolder,
  recentNotes,
  type NoteSummary,
  type TreeNode,
} from './note-list.ts';
import { drawerClassName } from './drawer.ts';
import { useTreeDrag, type TreeDrag } from './tree-drag.ts';
import { deleteNotes } from './note-delete.ts';
import { baseNameOf, displayNoteName } from './note-name.ts';
import { folderOf } from './relative-time.ts';
import { UpdateNotice, usePersistentStorage } from './pwa-notices.tsx';
import { NoteSaveScope, useNoteSave, useOnline } from './save-status.tsx';
import { ShortcutsDialog } from './shortcuts.tsx';
import { syncStateMessage } from './sync-state.ts';
import { RequireCurrentWorkspace } from './workspaces.tsx';
import {
  DeleteNoticeBar,
  DeleteNoticeProvider,
  useDeleteNotice,
} from './trash.tsx';

const NoteEditorLoader = lazy(async () => ({
  default: (await import('./note-editor.tsx')).NoteEditorLoader,
}));

/** How many notes the Recent section holds. */
const recentLimit = 6;

/** One note row of the tree. */
function NoteRow({
  note,
  basename,
  workspaceId,
  active,
  drag,
  onNavigate,
  onDelete,
}: {
  readonly note: NoteSummary;
  readonly basename: string;
  readonly workspaceId: string;
  readonly active: boolean;
  readonly drag?: TreeDrag | undefined;
  readonly onNavigate: () => void;
  readonly onDelete?: (() => void) | undefined;
}): ReactNode {
  const linkClassName = `flex min-h-11 items-center gap-2 rounded-lg px-2 text-control no-underline motion-safe:transition-colors md:min-h-8 ${
    onDelete === undefined
      ? active
        ? 'bg-active text-strong'
        : 'text-muted hover:bg-hover hover:text-strong'
      : active
        ? 'flex-1 text-strong'
        : 'flex-1 text-muted hover:bg-hover hover:text-strong'
  }`;
  const link = (
    <Link
      className={linkClassName}
      to={`/w/${workspaceId}/notes/${note.fileId}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      draggable={drag !== undefined}
      onDragStart={(event) => {
        drag?.begin(event, {
          kind: 'note',
          fileId: note.fileId,
          path: note.path,
        });
      }}
      onDragEnd={() => drag?.end()}
    >
      <span className="inline-flex shrink-0 items-center" aria-hidden="true">
        <FileTextIcon size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        {displayNoteName(basename)}
      </span>
      {note.localOnly || note.unsent ? (
        <span
          className="shrink-0 rounded-full border border-edge px-1.5 text-control text-muted"
          title="On this device only"
        >
          Local
        </span>
      ) : null}
    </Link>
  );
  if (onDelete === undefined) return link;
  return (
    <div
      className={`flex items-center gap-1 rounded-lg ${active ? 'bg-active' : ''}`}
    >
      {link}
      <Menu
        label={`Actions for the note ${displayNoteName(basename)}`}
        icon={<MoreIcon size={14} />}
        triggerClassName="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-transparent text-muted motion-safe:transition-colors hover:bg-hover hover:text-strong focus-visible:outline-2 focus-visible:outline-focus md:size-8"
        items={[
          {
            id: 'delete-note',
            label: 'Delete note',
            icon: <TrashIcon size={14} />,
            danger: true,
            onSelect: onDelete,
          },
        ]}
      />
    </div>
  );
}

/**
 * Renders the tree nodes as interactive collapsible lists.
 *
 * A row is a drag source and a folder row is a drop target. The handlers stay
 * thin: every rule of a drop lives in `folder-moves.ts` and the state of the
 * gesture lives in `tree-drag.ts`. The same moves are reachable without a
 * pointer through Move to folder and Rename folder.
 */
function TreeView({
  nodes,
  workspaceId,
  activeFileId,
  openFolders,
  drag,
  onToggleFolder,
  onRenameFolder,
  onDeleteFolder,
  onNewNoteIn,
  onDeleteNote,
  onNavigate,
}: {
  readonly nodes: readonly TreeNode[];
  readonly workspaceId: string;
  readonly activeFileId: string | null;
  readonly openFolders: ReadonlySet<string>;
  readonly drag: TreeDrag;
  readonly onToggleFolder: (path: string) => void;
  readonly onRenameFolder: (path: string) => void;
  readonly onDeleteFolder: (folder: string) => void;
  readonly onNewNoteIn: (path: string) => void;
  readonly onDeleteNote: (note: NoteSummary) => void;
  readonly onNavigate: () => void;
}): ReactNode {
  return (
    <ul className="m-0 list-none space-y-0.5 p-0">
      {nodes.map((node) => {
        if (node.kind === 'note')
          return (
            <li key={node.note.fileId}>
              <NoteRow
                note={node.note}
                basename={node.basename}
                workspaceId={workspaceId}
                active={node.note.fileId === activeFileId}
                drag={drag}
                onNavigate={onNavigate}
                onDelete={() => onDeleteNote(node.note)}
              />
            </li>
          );

        const isOpen = openFolders.has(node.fullPath);
        const isTarget = drag.over === node.fullPath;
        return (
          <li key={`folder:${node.fullPath}`}>
            <div
              className={`flex items-center gap-1 rounded-lg ${isTarget ? 'bg-active ring-2 ring-focus' : ''}`}
              onDragOver={(event) => {
                if (!drag.accepts(node.fullPath)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                drag.hover(node.fullPath);
              }}
              onDragLeave={() => {
                if (isTarget) drag.hover(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                drag.drop(node.fullPath);
              }}
            >
              <button
                type="button"
                className="flex min-h-11 flex-1 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-left text-control text-muted motion-safe:transition-colors hover:bg-hover hover:text-strong focus-visible:outline-2 focus-visible:outline-focus md:min-h-8"
                onClick={() => onToggleFolder(node.fullPath)}
                aria-expanded={isOpen}
                draggable
                onDragStart={(event) => {
                  drag.begin(event, { kind: 'folder', folder: node.fullPath });
                }}
                onDragEnd={() => drag.end()}
              >
                <span
                  className="inline-flex shrink-0 items-center"
                  aria-hidden="true"
                >
                  {isOpen ? (
                    <ChevronDownIcon size={14} />
                  ) : (
                    <ChevronRightIcon size={14} />
                  )}
                </span>
                <span
                  className="inline-flex shrink-0 items-center"
                  aria-hidden="true"
                >
                  {isOpen ? (
                    <FolderOpenIcon size={14} />
                  ) : (
                    <FolderIcon size={14} />
                  )}
                </span>
                <span className="min-w-0 truncate">{node.name}</span>
              </button>
              <Menu
                label={`Actions for the folder ${node.name}`}
                icon={<MoreIcon size={14} />}
                triggerClassName="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-transparent text-muted motion-safe:transition-colors hover:bg-hover hover:text-strong focus-visible:outline-2 focus-visible:outline-focus md:size-8"
                items={[
                  {
                    id: 'new-note',
                    label: 'New note in this folder',
                    icon: <PlusIcon size={14} />,
                    onSelect: () => onNewNoteIn(node.fullPath),
                  },
                  {
                    id: 'rename',
                    label: 'Rename folder',
                    icon: <PencilIcon size={14} />,
                    onSelect: () => onRenameFolder(node.fullPath),
                  },
                  {
                    id: 'delete-folder',
                    label: 'Delete folder',
                    icon: <TrashIcon size={14} />,
                    danger: true,
                    onSelect: () => onDeleteFolder(node.fullPath),
                  },
                ]}
              />
            </div>
            {isOpen ? (
              node.children.length === 0 ? (
                <p className="my-1 ml-3 border-l border-edge-subtle py-1 pl-3 text-control text-muted">
                  This folder is empty.
                </p>
              ) : (
                <div className="ml-3 border-l border-edge-subtle pl-1">
                  <TreeView
                    nodes={node.children}
                    workspaceId={workspaceId}
                    activeFileId={activeFileId}
                    openFolders={openFolders}
                    drag={drag}
                    onToggleFolder={onToggleFolder}
                    onRenameFolder={onRenameFolder}
                    onDeleteFolder={onDeleteFolder}
                    onNewNoteIn={onNewNoteIn}
                    onDeleteNote={onDeleteNote}
                    onNavigate={onNavigate}
                  />
                </div>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A quiet group label inside the sidebar. */
function GroupLabel({
  id,
  children,
  action,
}: {
  readonly id: string;
  readonly children: ReactNode;
  readonly action?: ReactNode | undefined;
}): ReactNode {
  return (
    <h2
      className="mb-1 flex min-h-8 items-center justify-between gap-2 px-2 text-control font-semibold uppercase tracking-wide text-muted"
      id={id}
    >
      <span>{children}</span>
      {action}
    </h2>
  );
}

/** The sidebar: the new note action, Recent, the folder tree, a footer. */
function Sidebar({
  workspaceId,
  onNavigate,
  onNewFolder,
  onRenameFolder,
  onNewNoteIn,
  onClose,
}: {
  readonly workspaceId: string;
  readonly onNavigate: () => void;
  readonly onNewFolder: () => void;
  readonly onRenameFolder: (folder: string) => void;
  readonly onNewNoteIn: (folder: string) => void;
  readonly onClose: () => void;
}): ReactNode {
  const params = useParams();
  const location = useLocation();
  const fileId = typeof params.fileId === 'string' ? params.fileId : null;
  const session = useSession();
  const store = useLocalStore();
  const sync = useSyncState();
  const files = useFiles();
  const online = useOnline();
  const { openFolders, toggleFolder, openFolder } = useOpenFolders(workspaceId);
  const drag = useTreeDrag({
    store: store.store,
    accountId: session.account?.accountId ?? null,
    workspaceId,
    notes: files.notes,
    emptyFolders: files.emptyFolders,
    moveEmptyFolders: files.moveEmptyFolders,
    openFolder,
  });
  const attentionCount = useAttentionCount(
    store.store,
    session.account?.accountId ?? null,
    workspaceId,
  );
  const recent = useMemo(
    () => recentNotes(files.notes, recentLimit),
    [files.notes],
  );
  const tree = useMemo(
    () => buildNoteTree(files.notes, files.emptyFolders),
    [files.notes, files.emptyFolders],
  );
  const trashPath = `/w/${workspaceId}/trash`;
  const navigate = useNavigate();
  const { announce } = useDeleteNotice();
  const requestSync = useRequestSync();
  const noteActions = useNoteActions();
  const [deleting, setDeleting] = useState(false);
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);
  const keptFoldersRef = useRef<Set<string>>(new Set());

  const accountId = session.account?.accountId ?? null;

  /** Keeps the folder of a deleted note so it stays in the tree. */
  useEffect(() => {
    const kept = keptFoldersRef.current;
    if (kept.size === 0) return;
    for (const folder of [...kept]) {
      if (notesInFolder(files.notes, folder).length === 0) {
        files.addEmptyFolder(folder);
        kept.delete(folder);
      }
    }
  }, [files.notes, files.addEmptyFolder]);

  /** Moves one note to the trash without a confirmation step. */
  const deleteNoteNow = (target: NoteSummary): void => {
    if (deleting) return;
    const name = displayNoteName(target.path);
    const folder = folderOf(target.path);
    if (
      noteActions !== null &&
      noteActions.fileId === target.fileId &&
      noteActions.delete !== null
    ) {
      const remove = noteActions.delete;
      setDeleting(true);
      setDeleteProblem(null);
      void (async (): Promise<void> => {
        let moved = false;
        try {
          moved = await remove();
        } catch {
          moved = false;
        }
        if (!moved) {
          setDeleting(false);
          setDeleteProblem('The note did not move to Trash. Try again.');
          return;
        }
        if (folder !== null) keptFoldersRef.current.add(folder);
        announce({
          workspaceId,
          items: [{ fileId: target.fileId, name }],
        });
        requestSync();
        setDeleting(false);
        setDeleteProblem(null);
        if (fileId === target.fileId) void navigate(`/w/${workspaceId}`);
      })();
      return;
    }
    const activeStore = store.store;
    if (activeStore === null || accountId === null) {
      setDeleteProblem(
        'Local storage is unavailable, so the note cannot be deleted.',
      );
      return;
    }
    setDeleting(true);
    setDeleteProblem(null);
    void (async (): Promise<void> => {
      const outcome = await deleteNotes(activeStore, accountId, workspaceId, [
        { fileId: target.fileId, name },
      ]);
      setDeleting(false);
      if (!outcome.ok) {
        setDeleteProblem(outcome.message);
        return;
      }
      if (folder !== null) keptFoldersRef.current.add(folder);
      announce({
        workspaceId,
        items: [{ fileId: target.fileId, name }],
      });
      requestSync();
      setDeleteProblem(null);
      if (fileId === target.fileId) void navigate(`/w/${workspaceId}`);
    })();
  };

  /** Moves every note under one folder to the trash without a confirm step. */
  const deleteFolderNow = (folder: string): void => {
    if (deleting) return;
    const targets = notesInFolder(files.notes, folder);
    if (targets.length === 0) {
      files.removeEmptyFolders(folder);
      return;
    }
    const items = targets.map((note) => ({
      fileId: note.fileId,
      name: displayNoteName(note.path),
    }));
    const activeStore = store.store;
    if (activeStore === null || accountId === null) {
      setDeleteProblem(
        'Local storage is unavailable, so the folder cannot be deleted.',
      );
      return;
    }
    const openInFolder =
      noteActions !== null &&
      noteActions.delete !== null &&
      fileId !== null &&
      noteActions.fileId === fileId &&
      targets.some((note) => note.fileId === fileId);
    const editorDelete = openInFolder ? (noteActions?.delete ?? null) : null;
    setDeleting(true);
    setDeleteProblem(null);
    void (async (): Promise<void> => {
      let problem: string | null = null;
      let openMoved = false;
      if (editorDelete !== null && fileId !== null) {
        try {
          openMoved = await editorDelete();
        } catch {
          openMoved = false;
        }
        if (!openMoved)
          problem = 'The open note did not move to Trash. Try again.';
      }
      const rest =
        openInFolder && fileId !== null
          ? items.filter((item) => item.fileId !== fileId)
          : items;
      let restDeleted: readonly string[] = [];
      if (rest.length > 0) {
        const outcome = await deleteNotes(
          activeStore,
          accountId,
          workspaceId,
          rest,
        );
        restDeleted = outcome.deleted;
        if (!outcome.ok && problem === null) problem = outcome.message;
      }
      const movedIds = new Set<string>([
        ...(openMoved && fileId !== null ? [fileId] : []),
        ...restDeleted,
      ]);
      const movedItems = items.filter((item) => movedIds.has(item.fileId));
      if (movedItems.length > 0) {
        announce({ workspaceId, items: movedItems });
        requestSync();
        files.removeEmptyFolders(folder);
      }
      setDeleting(false);
      if (problem !== null) {
        setDeleteProblem(problem);
        if (openMoved && fileId !== null) void navigate(`/w/${workspaceId}`);
        return;
      }
      setDeleteProblem(null);
      if (openMoved && fileId !== null) void navigate(`/w/${workspaceId}`);
    })();
  };

  return (
    <>
      <div className="flex h-header shrink-0 items-center justify-between gap-2 border-b border-edge-subtle px-2 md:hidden">
        <span className="text-ui font-semibold text-strong">Notes</span>
        <Button
          variant="ghost"
          size="sm"
          label="Close navigation"
          title="Close navigation"
          icon={<CloseIcon size={18} />}
          onClick={onClose}
        />
      </div>

      {session.account !== null ? (
        <div className="flex items-center gap-1 px-2 py-2">
          <NewNoteButton
            store={store.store}
            accountId={session.account.accountId}
            workspaceId={workspaceId}
            variant="primary"
            className="min-w-0 flex-1"
          />
          <Button
            variant="ghost"
            size="sm"
            label="New folder"
            title="New folder"
            icon={<FolderPlusIcon size={16} />}
            onClick={onNewFolder}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {recent.length > 0 ? (
          <section aria-labelledby="recent-heading" className="mb-3">
            <GroupLabel id="recent-heading">Recent</GroupLabel>
            <ul className="m-0 list-none space-y-0.5 p-0">
              {recent.map((note) => (
                <li key={note.fileId}>
                  <NoteRow
                    note={note}
                    basename={baseNameOf(note.path)}
                    workspaceId={workspaceId}
                    active={note.fileId === fileId}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="tree-heading">
          <div
            className={`rounded-lg ${drag.over === '' ? 'bg-active ring-2 ring-focus' : ''}`}
            onDragOver={(event) => {
              if (!drag.accepts('')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              drag.hover('');
            }}
            onDragLeave={() => {
              if (drag.over === '') drag.hover(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              drag.drop('');
            }}
          >
            <GroupLabel id="tree-heading">All notes</GroupLabel>
          </div>
          {files.loading ? (
            <StatusRegion message="Loading your notes." />
          ) : tree.length === 0 ? (
            <p className="my-1 px-2 text-control text-muted">No notes yet.</p>
          ) : (
            <TreeView
              nodes={tree}
              workspaceId={workspaceId}
              activeFileId={fileId}
              openFolders={openFolders}
              drag={drag}
              onToggleFolder={toggleFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={deleteFolderNow}
              onNewNoteIn={onNewNoteIn}
              onDeleteNote={deleteNoteNow}
              onNavigate={onNavigate}
            />
          )}
        </section>
        {deleteProblem === null ? null : (
          <p className="mx-2 my-2 text-control text-danger" role="alert">
            {deleteProblem}
          </p>
        )}
        {drag.problem === null ? null : (
          <p className="mx-2 my-2 text-control text-danger" role="alert">
            {drag.problem}
          </p>
        )}
      </div>

      <div className="border-t border-edge-subtle p-2">
        <p className="m-0 px-2 pb-1 text-control text-muted">
          {online
            ? syncStateMessage(sync.state, sync.noteName)
            : 'No connection. Your notes stay on this device.'}
        </p>
        <Link
          className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-control text-muted no-underline motion-safe:transition-colors hover:bg-hover hover:text-strong md:min-h-8"
          to={trashPath}
          onClick={onNavigate}
          aria-current={location.pathname === trashPath ? 'page' : undefined}
        >
          <span
            className="inline-flex shrink-0 items-center"
            aria-hidden="true"
          >
            <TrashIcon size={14} />
          </span>
          <span>Trash</span>
        </Link>
        <AttentionLink workspaceId={workspaceId} count={attentionCount} />
        {store.error !== null ? (
          <p className="my-1 px-2 text-control text-danger" role="alert">
            {store.error}
          </p>
        ) : null}
      </div>
    </>
  );
}

/** The application frame. */
export function Shell(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : '';
  return (
    <RequireCurrentWorkspace workspaceId={workspaceId}>
      <FilesProvider workspaceId={workspaceId}>
        <ShellFrame workspaceId={workspaceId} />
      </FilesProvider>
    </RequireCurrentWorkspace>
  );
}

/** The frame of one open notes area. */
function ShellFrame({
  workspaceId,
}: {
  readonly workspaceId: string;
}): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameFolder, setRenameFolder] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const drawerWasOpenRef = useRef(false);
  const session = useSession();
  const store = useLocalStore();
  const theme = useTheme();
  const files = useFiles();
  const accountId = session.account?.accountId ?? null;
  const sync = useWorkspaceSync(store.store, accountId, workspaceId);
  const persistence = usePersistentStorage(useSavedOnce());
  const newNote = useCreateNote(store.store, accountId, workspaceId);
  const noteActions = useNoteActions();
  // Every folder the tree can show: the ones the note paths imply and the
  // ones that hold no note yet.
  const allFolders = useMemo(
    () =>
      [...new Set([...files.folders, ...files.emptyFolders])].sort(
        (left, right) => (left < right ? -1 : 1),
      ),
    [files.folders, files.emptyFolders],
  );

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === 'k' || key === 'o')) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!drawerOpen) {
      if (drawerWasOpenRef.current) menuButtonRef.current?.focus();
      drawerWasOpenRef.current = false;
      return;
    }
    drawerWasOpenRef.current = true;
    const sidebar = sidebarRef.current;
    const focusable = (): HTMLElement[] =>
      sidebar === null
        ? []
        : Array.from(
            sidebar.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          );
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const targets = focusable();
      const first = targets[0];
      const last = targets.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  const cycleTheme = useCallback((): void => {
    const order = ['system', 'light', 'dark'] as const;
    const at = order.indexOf(theme.choice);
    theme.setChoice(order[(at + 1) % order.length] ?? 'system');
  }, [theme]);

  const themeName =
    theme.choice === 'system'
      ? 'System'
      : theme.choice === 'light'
        ? 'Light'
        : 'Dark';

  const menuItems: readonly MenuItem[] = [
    {
      id: 'theme',
      label: 'Theme',
      hint: themeName,
      icon:
        theme.choice === 'system' ? (
          <ComputerIcon size={14} />
        ) : theme.choice === 'light' ? (
          <SunIcon size={14} />
        ) : (
          <MoonIcon size={14} />
        ),
      onSelect: cycleTheme,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <SettingsIcon size={14} />,
      onSelect: () => {
        void navigate('/settings');
      },
    },
    {
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      onSelect: () => setShortcutsOpen(true),
    },
    {
      id: 'sign-out',
      label: 'Sign out',
      onSelect: () => session.signOut(),
    },
  ];

  const paletteActions = useMemo(
    () => [
      {
        id: 'new-note',
        label: 'New note',
        keywords: 'create add',
        run: () => newNote.create(),
      },
      {
        id: 'new-folder',
        label: 'New folder',
        keywords: 'create add group',
        run: () => setNewFolderOpen(true),
      },
      {
        id: 'toggle-theme',
        label: 'Toggle theme',
        keywords: 'dark light system palette',
        run: cycleTheme,
      },
      {
        id: 'shortcuts',
        label: 'Show keyboard shortcuts',
        keywords: 'keys help',
        run: () => setShortcutsOpen(true),
      },
      ...(noteActions === null
        ? []
        : [
            {
              id: 'history',
              label: 'Open the history of this note',
              keywords: 'versions revisions',
              run: (): void => {
                void navigate(
                  `/w/${workspaceId}/notes/${noteActions.fileId}/history`,
                );
              },
            },
          ]),
      ...(noteActions?.toggleReadMode == null
        ? []
        : [
            {
              id: 'read-mode',
              label: 'Toggle Read mode',
              keywords: 'write preview render',
              run: noteActions.toggleReadMode,
            },
          ]),
      {
        id: 'trash',
        label: 'Go to Trash',
        keywords: 'deleted restore',
        run: () => {
          void navigate(`/w/${workspaceId}/trash`);
        },
      },
      {
        id: 'settings',
        label: 'Go to Settings',
        keywords: 'account theme sign out',
        run: () => {
          void navigate('/settings');
        },
      },
    ],
    [cycleTheme, navigate, newNote.create, noteActions, workspaceId],
  );

  return (
    <SyncProvider value={sync}>
      <DeleteNoticeProvider>
        <NoteSaveScope>
          <NoteActionsScope>
            <div className="flex h-dvh flex-col bg-app text-ink">
              <a
                className="fixed left-2 top-2 z-50 -translate-y-20 rounded-lg bg-accent-fill px-3 py-2 text-on-accent focus:translate-y-0"
                href="#notes-content"
              >
                Skip to content
              </a>

              <header className="z-30 flex h-header shrink-0 items-center gap-2 border-b border-edge-subtle bg-card px-2 sm:px-3">
                <Button
                  buttonRef={menuButtonRef}
                  variant="ghost"
                  size="sm"
                  className="md:hidden"
                  label="Open navigation"
                  title="Open navigation"
                  icon={<MenuIcon size={18} />}
                  ariaControls="notes-sidebar"
                  ariaExpanded={drawerOpen}
                  onClick={() => {
                    setDrawerOpen((open) => !open);
                  }}
                />

                <Link
                  className="flex shrink-0 items-center gap-2 text-ui font-semibold text-strong no-underline"
                  to="/"
                >
                  <span
                    className="inline-flex size-7 items-center justify-center rounded-lg bg-accent-fill text-on-accent"
                    aria-hidden="true"
                  >
                    <WorkspaceIcon size={16} />
                  </span>
                  <span className="hidden sm:inline">Notesapp</span>
                </Link>

                <button
                  type="button"
                  className="mx-auto flex min-h-11 w-full max-w-md min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-edge bg-app px-3 text-control text-muted motion-safe:transition-colors hover:bg-hover hover:text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-8"
                  onClick={() => setPaletteOpen(true)}
                >
                  <span
                    className="inline-flex shrink-0 items-center"
                    aria-hidden="true"
                  >
                    <SearchIcon size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">
                    Search notes
                  </span>
                  <kbd className="hidden shrink-0 rounded border border-edge bg-hover px-1.5 text-control text-muted sm:inline">
                    Ctrl K
                  </kbd>
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  <Menu
                    label="More actions"
                    icon={<MoreIcon size={18} />}
                    items={menuItems}
                  />
                </div>
              </header>

              <div
                className={
                  drawerOpen
                    ? 'fixed inset-0 z-30 bg-scrim/70 md:hidden'
                    : 'hidden'
                }
                role="presentation"
                onClick={() => setDrawerOpen(false)}
              />

              <aside
                ref={sidebarRef}
                id="notes-sidebar"
                className={drawerClassName(drawerOpen)}
                aria-label="Notes navigation"
                aria-modal={drawerOpen ? true : undefined}
                role={drawerOpen ? 'dialog' : undefined}
              >
                <Sidebar
                  workspaceId={workspaceId}
                  onNavigate={() => setDrawerOpen(false)}
                  onNewFolder={() => setNewFolderOpen(true)}
                  onRenameFolder={(folder) => setRenameFolder(folder)}
                  onNewNoteIn={(folder) => newNote.create(folder)}
                  onClose={() => setDrawerOpen(false)}
                />
              </aside>

              <div
                id="notes-content"
                className="min-h-0 flex-1 overflow-y-auto md:pl-64"
              >
                <div className="mx-auto w-full max-w-3xl px-4 pt-4 empty:hidden sm:px-6">
                  <UpdateNotice
                    store={store.store}
                    onFlushDrafts={() => Promise.resolve()}
                  />
                  {session.error === null ? null : (
                    <Notice tone="info" message={session.error} />
                  )}
                  {theme.syncError === null ? null : (
                    <Notice tone="info" message={theme.syncError} />
                  )}
                  {persistence.denial === null ? null : (
                    <Notice tone="problem" message={persistence.denial}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={persistence.dismiss}
                      >
                        Understood
                      </Button>
                    </Notice>
                  )}
                </div>
                <Outlet />
              </div>

              <DeleteNoticeBar />

              <CommandPalette
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
                workspaceId={workspaceId}
                notes={files.notes}
                store={store.store}
                accountId={accountId}
                actions={paletteActions}
              />
              <ShortcutsDialog
                open={shortcutsOpen}
                onClose={() => setShortcutsOpen(false)}
              />
              <NewFolderDialog
                open={newFolderOpen}
                onClose={() => setNewFolderOpen(false)}
                folders={allFolders}
                onCreated={(folder) => files.addEmptyFolder(folder)}
              />
              {session.account === null || renameFolder === null ? null : (
                <RenameFolderDialog
                  open
                  onClose={() => setRenameFolder(null)}
                  store={store.store}
                  accountId={session.account.accountId}
                  workspaceId={workspaceId}
                  notes={files.notes}
                  folders={allFolders}
                  folder={renameFolder}
                  onRenamed={(toFolder) => {
                    files.moveEmptyFolders(renameFolder, toFolder);
                    setRenameFolder(null);
                  }}
                />
              )}
            </div>
          </NoteActionsScope>
        </NoteSaveScope>
      </DeleteNoticeProvider>
    </SyncProvider>
  );
}

/** Whether this session already created one version of any note. */
function useSavedOnce(): boolean {
  const note = useNoteSave();
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (note?.lastSavedAt != null) setSeen(true);
  }, [note]);
  return seen;
}

/** The note list of the open area. */
export function NotesHomeView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : '';
  const files = useFiles();
  useDocumentTitle('All notes');

  const ordered = useMemo(() => recentNotes(files.notes, 200), [files.notes]);

  return (
    <Page width="wide">
      <PageHeader
        title="All notes"
        description={`${String(ordered.length)} ${ordered.length === 1 ? 'note' : 'notes'}`}
      />
      {files.loading ? (
        <StatusRegion message="Loading your notes." />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={<FileTextIcon size={32} />}
          title="No notes yet."
          description="Select New note in the sidebar, or press Cmd or Ctrl and K and select New note."
        />
      ) : (
        <ul className="m-0 list-none p-0">
          {ordered.map((note) => (
            <li key={note.fileId}>
              <Link
                to={`/w/${workspaceId}/notes/${note.fileId}`}
                className="flex min-h-11 items-center gap-3 border-b border-edge-subtle px-2 py-2 text-ink no-underline motion-safe:transition-colors hover:bg-hover"
              >
                <span
                  className="inline-flex shrink-0 items-center text-muted"
                  aria-hidden="true"
                >
                  <FileTextIcon size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-ui font-medium text-strong">
                  {displayNoteName(note.path.split('/').at(-1) ?? note.path)}
                </span>
                {note.path.includes('/') ? (
                  <span className="hidden shrink-0 text-control text-muted sm:inline">
                    {note.path.slice(0, note.path.lastIndexOf('/'))}
                  </span>
                ) : null}
                <span className="shrink-0 text-control text-muted">
                  {new Date(note.updatedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/** One note: unknown, purged, empty, and readable states stay distinct. */
export function NoteView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const fileId = typeof params.fileId === 'string' ? params.fileId : null;
  const session = useSession();
  const store = useLocalStore();
  const files = useFiles();
  const [moveOpen, setMoveOpen] = useState(false);
  const [movedNote, setMovedNote] = useState<{
    readonly fileId: string;
    readonly path: string;
  } | null>(null);
  const moveFolders = useMemo(
    () =>
      [...new Set([...files.folders, ...files.emptyFolders])].sort(
        (left, right) => (left < right ? -1 : 1),
      ),
    [files.folders, files.emptyFolders],
  );
  const notePath =
    files.notes.find((note) => note.fileId === fileId)?.path ?? null;
  useDocumentTitle(notePath === null ? null : displayNoteName(notePath));

  if (workspaceId === null || fileId === null)
    return (
      <Page>
        <PageHeader title="Note not found" />
        <p className="m-0">
          The address names no note. It may be removed, or the address may be
          wrong. This is not an empty note.
        </p>
      </Page>
    );

  const accountId = session.account?.accountId ?? null;
  if (accountId === null)
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <StatusRegion message="Loading the note." />
      </main>
    );

  return (
    <main className="flex h-full min-w-0 flex-col">
      <Suspense fallback={<StatusRegion message="Loading the editor." />}>
        <NoteEditorLoader
          store={store.store}
          accountId={accountId}
          workspaceId={workspaceId}
          fileId={fileId}
          onMoveToFolder={() => setMoveOpen(true)}
          movedPath={movedNote?.fileId === fileId ? movedNote.path : null}
        />
      </Suspense>
      {notePath === null ? null : (
        <MoveNoteDialog
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
          store={store.store}
          accountId={accountId}
          workspaceId={workspaceId}
          notes={files.notes}
          folders={moveFolders}
          fileId={fileId}
          path={notePath}
          onMoved={(toPath) => {
            setMovedNote({ fileId, path: toPath });
            setMoveOpen(false);
          }}
        />
      )}
    </main>
  );
}
