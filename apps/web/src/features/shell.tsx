/**
 * Application shell: responsive layout, workspace navigation, and file tree.
 *
 * The shell owns routing chrome only: a header, a sidebar that becomes a
 * drawer on phones, the workspace selector, recent files, the file tree, the
 * status region, and the collapsible outline and backlinks region. Note
 * content editing lives in the note editor screen; the note view tells an
 * unknown note apart from an empty file and otherwise opens that editor.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { listFiles, type WorkspaceFileSummary } from '@notesapp/api-client';
import {
  Badge,
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  CollapsibleSection,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  HistoryIcon,
  MenuIcon,
  MoonIcon,
  StatusRegion,
  SunIcon,
  UserIcon,
  WorkspaceIcon,
} from '@notesapp/ui';
import '../shell.css';
import {
  problemMessage,
  useLocalSnapshotStatus,
  useLocalStore,
  useSession,
  useTheme,
  useWorkspaceSync,
} from '../app.tsx';
import {
  canWrite,
  findWorkspace,
  useWorkspaces,
  WorkspaceMembers,
  WorkspaceOwnerControls,
} from './workspaces.tsx';
import { NewNoteButton } from './new-note.tsx';
import { BacklinksPanel, OutlinePanel } from './backlinks.tsx';
import { SearchDialog } from './search.tsx';

const NoteEditorLoader = lazy(async () => ({
  default: (await import('./note-editor.tsx')).NoteEditorLoader,
}));
const SharingPanel = lazy(async () => ({
  default: (await import('./sharing.tsx')).SharingPanel,
}));

/** One page of files merged into a full list. */
async function loadAllFiles(
  workspaceId: string,
): Promise<{ readonly files: readonly WorkspaceFileSummary[] }> {
  const files: WorkspaceFileSummary[] = [];
  let cursor: string | null = null;
  let firstPage = true;
  for (;;) {
    const query: { readonly cursor?: string; readonly limit?: number } =
      firstPage || cursor === null ? { limit: 100 } : { cursor, limit: 100 };
    firstPage = false;
    const result = await listFiles({
      path: { workspaceId },
      query: { ...query },
    });
    if (result.error !== undefined || result.data === undefined)
      throw new Error(problemMessage(result.error));
    files.push(...result.data.files);
    if (result.data.nextCursor === null) break;
    cursor = result.data.nextCursor;
  }
  return { files };
}

/** The newest files first, at most five. */
function recentFiles(
  files: readonly WorkspaceFileSummary[],
): readonly WorkspaceFileSummary[] {
  return [...files]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 5);
}

/** One node of the rendered file tree. */
export type TreeNode =
  | {
      readonly kind: 'file';
      readonly file: WorkspaceFileSummary;
      readonly basename: string;
    }
  | {
      readonly kind: 'folder';
      readonly name: string;
      readonly fullPath: string;
      readonly children: readonly TreeNode[];
    };

/** Groups flat file paths into a folder tree. */
export function buildFileTree(
  files: readonly WorkspaceFileSummary[],
): readonly TreeNode[] {
  type MutableFolder = {
    readonly folders: Map<string, MutableFolder>;
    readonly files: Array<{
      readonly file: WorkspaceFileSummary;
      readonly basename: string;
    }>;
  };
  const root: MutableFolder = { folders: new Map(), files: [] };
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const file of ordered) {
    const segments = file.path.split('/');
    let current = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index] ?? '';
      let next = current.folders.get(segment);
      if (next === undefined) {
        next = { folders: new Map(), files: [] };
        current.folders.set(segment, next);
      }
      current = next;
    }
    const basename = segments.at(-1) ?? file.path;
    current.files.push({ file, basename });
  }
  const render = (
    folder: MutableFolder,
    prefix: string,
  ): readonly TreeNode[] => {
    const folders = [...folder.folders.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([name, child]): TreeNode => {
        const fullPath = prefix === '' ? name : `${prefix}/${name}`;
        return {
          kind: 'folder',
          name,
          fullPath,
          children: render(child, fullPath),
        };
      });
    const leaves = folder.files.map(({ file, basename }): TreeNode => ({
      kind: 'file',
      file,
      basename,
    }));
    return [...folders, ...leaves];
  };
  return render(root, '');
}

/** Renders the tree nodes as interactive collapsible lists. */
function TreeView({
  nodes,
  workspaceId,
  activeFileId,
  openFolders,
  onToggleFolder,
  onNavigate,
}: {
  readonly nodes: readonly TreeNode[];
  readonly workspaceId: string;
  readonly activeFileId: string | null;
  readonly openFolders: ReadonlySet<string>;
  readonly onToggleFolder: (path: string) => void;
  readonly onNavigate: () => void;
}): ReactNode {
  if (nodes.length === 0) {
    return <p className="notes-status-region">No files yet.</p>;
  }

  return (
    <ul className="notes-tree-list">
      {nodes.map((node) => {
        if (node.kind === 'file') {
          const isActive = node.file.fileId === activeFileId;
          return (
            <li key={node.file.fileId}>
              <Link
                className={`notes-tree-item${isActive ? ' active' : ''}`}
                to={`/w/${workspaceId}/notes/${node.file.fileId}`}
                onClick={onNavigate}
                title={node.file.path}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="notes-tree-icon" aria-hidden="true">
                  <FileTextIcon size={14} />
                </span>
                <span className="notes-tree-file-name">{node.basename}</span>
              </Link>
            </li>
          );
        }

        const isOpen = openFolders.has(node.fullPath);
        return (
          <li key={`folder:${node.fullPath}`}>
            <button
              type="button"
              className="notes-tree-folder-btn"
              onClick={() => onToggleFolder(node.fullPath)}
              aria-expanded={isOpen}
            >
              <span className="notes-tree-icon" aria-hidden="true">
                {isOpen ? (
                  <ChevronDownIcon size={13} />
                ) : (
                  <ChevronRightIcon size={13} />
                )}
              </span>
              <span className="notes-tree-icon" aria-hidden="true">
                {isOpen ? (
                  <FolderOpenIcon size={15} />
                ) : (
                  <FolderIcon size={15} />
                )}
              </span>
              <span className="notes-tree-file-name">{node.name}</span>
            </button>
            {isOpen ? (
              <div className="notes-tree-nested">
                <TreeView
                  nodes={node.children}
                  workspaceId={workspaceId}
                  activeFileId={activeFileId}
                  openFolders={openFolders}
                  onToggleFolder={onToggleFolder}
                  onNavigate={onNavigate}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The sidebar: selector, filter, recent files, tree, and panels. */
function Sidebar({
  workspaceId,
  onNavigate,
}: {
  readonly workspaceId: string | null;
  readonly onNavigate: () => void;
}): ReactNode {
  const { state } = useWorkspaces();
  const params = useParams();
  const fileId = typeof params.fileId === 'string' ? params.fileId : null;
  const session = useSession();
  const store = useLocalStore();
  const [filter, setFilter] = useState('');
  const [files, setFiles] = useState<readonly WorkspaceFileSummary[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const activeWorkspace = useMemo(() => {
    if (state.status !== 'ready' || workspaceId === null) return null;
    return findWorkspace(state.workspaces, workspaceId);
  }, [state, workspaceId]);

  const toggleFolder = useCallback((folderPath: string): void => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  useEffect(() => {
    if (workspaceId === null) {
      setFiles([]);
      return;
    }
    const activeWs = workspaceId;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const loaded = await loadAllFiles(activeWs);
        if (!cancelled) {
          setFiles(loaded.files);
          // Expand all folders by default on initial file load
          const allFolders = new Set<string>();
          for (const file of loaded.files) {
            const parts = file.path.split('/');
            let current = '';
            for (let i = 0; i < parts.length - 1; i += 1) {
              const segment = parts[i] ?? '';
              if (segment === '') continue;
              current = current === '' ? segment : `${current}/${segment}`;
              allFolders.add(current);
            }
          }
          setOpenFolders(allFolders);
        }
      } catch {
        if (!cancelled) setFiles([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return files;
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, filter]);

  const canEdit = activeWorkspace !== null && canWrite(activeWorkspace.role);

  return (
    <>
      {activeWorkspace !== null ? (
        <div className="notes-sidebar-workspace">
          <div className="notes-sidebar-workspace-info">
            <span className="notes-tree-icon" aria-hidden="true">
              <WorkspaceIcon size={16} />
            </span>
            <span className="notes-sidebar-workspace-name">
              {activeWorkspace.name}
            </span>
          </div>
          <Badge
            variant={activeWorkspace.role === 'owner' ? 'accent' : 'default'}
          >
            {activeWorkspace.role}
          </Badge>
        </div>
      ) : null}

      {workspaceId !== null && canEdit && session.account !== null ? (
        <div className="notes-sidebar-action">
          <NewNoteButton
            store={store.store}
            accountId={session.account.accountId}
            workspaceId={workspaceId}
            variant="primary"
          />
        </div>
      ) : null}

      <nav aria-label="Workspaces" className="notes-sidebar-section">
        <h2 className="notes-sidebar-heading">Workspaces</h2>
        {state.status === 'ready' ? (
          <ul className="notes-tree-list">
            {state.workspaces.map((entry) => {
              const isActive = entry.workspaceId === workspaceId;
              return (
                <li key={entry.workspaceId}>
                  <Link
                    className={`notes-tree-item${isActive ? ' active' : ''}`}
                    to={`/w/${entry.workspaceId}`}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="notes-tree-icon" aria-hidden="true">
                      <WorkspaceIcon size={14} />
                    </span>
                    <span className="notes-tree-file-name">{entry.name}</span>
                    <Badge
                      variant={entry.role === 'owner' ? 'accent' : 'default'}
                    >
                      {entry.role}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <StatusRegion message="Loading workspaces." />
        )}
      </nav>

      {workspaceId === null ? null : (
        <>
          <SearchDialog
            store={store.store}
            accountId={session.account?.accountId ?? null}
            workspaceId={workspaceId}
            onNavigate={onNavigate}
          />

          {recentFiles(files).length > 0 ? (
            <section
              aria-labelledby="recent-heading"
              className="notes-sidebar-section"
            >
              <h2 id="recent-heading" className="notes-sidebar-heading">
                Recent files
              </h2>
              <ul className="notes-tree-list">
                {recentFiles(files).map((file) => {
                  const isActive = file.fileId === fileId;
                  const basename = file.path.split('/').at(-1) ?? file.path;
                  return (
                    <li key={file.fileId}>
                      <Link
                        className={`notes-tree-item${isActive ? ' active' : ''}`}
                        to={`/w/${workspaceId}/notes/${file.fileId}`}
                        onClick={onNavigate}
                        title={file.path}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <span className="notes-tree-icon" aria-hidden="true">
                          <HistoryIcon size={14} />
                        </span>
                        <span className="notes-tree-file-name">{basename}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section
            aria-labelledby="tree-heading"
            className="notes-sidebar-section"
          >
            <h2 id="tree-heading" className="notes-sidebar-heading">
              <span>Files</span>
              <span className="notes-collapsible-count">{files.length}</span>
            </h2>
            <input
              id="notes-filter"
              className="notes-input"
              type="search"
              value={filter}
              placeholder="Filter files..."
              aria-label="Filter files"
              onChange={(event): void => {
                setFilter(event.target.value);
              }}
            />
            <TreeView
              nodes={buildFileTree(visible)}
              workspaceId={workspaceId}
              activeFileId={fileId}
              openFolders={openFolders}
              onToggleFolder={toggleFolder}
              onNavigate={onNavigate}
            />
          </section>

          <CollapsibleSection
            id="notes-outline"
            title="Outline"
            open={outlineOpen}
            onToggle={setOutlineOpen}
          >
            <OutlinePanel workspaceId={workspaceId} fileId={fileId} />
          </CollapsibleSection>

          <CollapsibleSection
            id="notes-backlinks"
            title="Backlinks"
            open={backlinksOpen}
            onToggle={setBacklinksOpen}
          >
            <BacklinksPanel
              workspaceId={workspaceId}
              fileId={fileId}
              onNavigate={onNavigate}
            />
          </CollapsibleSection>
        </>
      )}
    </>
  );
}

/**
 * The application frame.
 *
 * On wide screens the sidebar sits next to the content. On phones it is a
 * drawer that the header button opens and that closes on navigation.
 */
export function Shell(): ReactNode {
  const location = useLocation();
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const session = useSession();
  const store = useLocalStore();
  const { resolved, setChoice } = useTheme();
  const { state: workspaceState } = useWorkspaces();

  const activeWorkspace = useMemo(() => {
    if (workspaceState.status !== 'ready' || workspaceId === null) return null;
    return findWorkspace(workspaceState.workspaces, workspaceId);
  }, [workspaceState, workspaceId]);

  const canEdit = activeWorkspace !== null && canWrite(activeWorkspace.role);
  const accountId = session.account?.accountId ?? null;
  const syncMessage = useWorkspaceSync(store.store, accountId, workspaceId);
  const localMessage = useLocalSnapshotStatus(
    store.store,
    accountId,
    workspaceId,
  );

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const toggleTheme = (): void => {
    setChoice(resolved === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className={`notes-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <a className="notes-skip-link" href="#notes-content">
        Skip to content
      </a>

      <header className="notes-header">
        <Button
          variant="ghost"
          size="sm"
          className="notes-header-menu-btn"
          label={drawerOpen ? 'Close navigation' : 'Open navigation'}
          icon={<MenuIcon size={18} />}
          onClick={() => {
            setDrawerOpen((open) => !open);
          }}
        >
          Menu
        </Button>

        <div className="notes-header-brand-group">
          <Link className="notes-brand" to="/">
            <span className="notes-brand-badge" aria-hidden="true">
              <WorkspaceIcon size={16} />
            </span>
            <span>Notesapp</span>
          </Link>
          {activeWorkspace !== null ? (
            <Link
              to={`/w/${activeWorkspace.workspaceId}`}
              className="notes-header-workspace-badge"
              title={`Active workspace: ${activeWorkspace.name}`}
            >
              <span>{activeWorkspace.name}</span>
            </Link>
          ) : null}
        </div>

        <span className="notes-header-spacer" />

        <div className="notes-header-actions">
          {workspaceId !== null && canEdit && session.account !== null ? (
            <NewNoteButton
              store={store.store}
              accountId={session.account.accountId}
              workspaceId={workspaceId}
              variant="primary"
              size="sm"
            />
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            label={
              resolved === 'dark'
                ? 'Switch to light mode'
                : 'Switch to dark mode'
            }
            icon={
              resolved === 'dark' ? (
                <SunIcon size={16} />
              ) : (
                <MoonIcon size={16} />
              )
            }
            onClick={toggleTheme}
          >
            {resolved === 'dark' ? 'Light' : 'Dark'}
          </Button>

          <Link
            className="notes-account-pill"
            to="/settings"
            title="Account settings"
          >
            <UserIcon size={14} />
            <span>{session.account?.email ?? 'Account'}</span>
          </Link>
        </div>
      </header>

      <div
        className="notes-drawer-backdrop"
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      <aside
        id="notes-sidebar"
        className="notes-sidebar"
        aria-label="Notes navigation"
      >
        <Sidebar
          workspaceId={workspaceId}
          onNavigate={() => setDrawerOpen(false)}
        />
        <div className="notes-sidebar-footer">
          <StatusRegion message={syncMessage} />
          {localMessage !== '' ? <StatusRegion message={localMessage} /> : null}
          {store.error !== null ? (
            <p className="notes-status-error" role="alert">
              {store.error}
            </p>
          ) : null}
        </div>
      </aside>

      <div id="notes-content" className="notes-content">
        <Outlet />
      </div>
    </div>
  );
}

/** One workspace: files, membership, and owner controls. */
export function WorkspaceView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const { state, reload } = useWorkspaces();

  if (workspaceId === null)
    return (
      <main>
        <h1>Workspace not found</h1>
        <p>The address names no workspace.</p>
      </main>
    );
  if (state.status === 'loading')
    return (
      <main>
        <StatusRegion message="Loading the workspace." />
      </main>
    );
  if (state.status === 'error')
    return (
      <main>
        <h1>Workspace</h1>
        <p className="notes-status-error" role="alert">
          {state.message}
        </p>
      </main>
    );

  const workspace = findWorkspace(state.workspaces, workspaceId);
  if (workspace === null)
    return (
      <main>
        <h1>Workspace not found</h1>
        <p>
          This account has no workspace with that ID. It may be removed, or the
          address may be wrong.
        </p>
        <p>
          <Link to="/">Back to workspaces.</Link>
        </p>
      </main>
    );

  return (
    <WorkspaceDetail
      workspaceId={workspace.workspaceId}
      name={workspace.name}
      role={workspace.role}
      personal={workspace.personal}
      onChanged={reload}
    />
  );
}

/** The workspace detail after its membership is known. */
function WorkspaceDetail({
  workspaceId,
  name,
  role,
  personal,
  onChanged,
}: {
  readonly workspaceId: string;
  readonly name: string;
  readonly role: 'owner' | 'admin' | 'editor' | 'viewer';
  readonly personal: boolean;
  readonly onChanged: () => void;
}): ReactNode {
  const writable = canWrite(role);
  const session = useSession();
  const store = useLocalStore();

  return (
    <main>
      <div className="notes-doc-header">
        <div className="notes-doc-toolbar">
          <div>
            <h1 style={{ margin: '0 0 4px 0' }}>{name}</h1>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Badge variant={role === 'owner' ? 'accent' : 'default'}>
                Role: {role}
              </Badge>
              {personal ? <Badge variant="default">Personal</Badge> : null}
            </div>
          </div>
          {writable && session.account !== null ? (
            <NewNoteButton
              store={store.store}
              accountId={session.account.accountId}
              workspaceId={workspaceId}
              variant="primary"
            />
          ) : null}
        </div>
        <div className="notes-doc-nav-links">
          <Link to={`/w/${workspaceId}/conflicts`}>Conflicts</Link>
          <span>•</span>
          <Link to={`/w/${workspaceId}/purge`}>Deletion and purge</Link>
          <span>•</span>
          <Link to={`/w/${workspaceId}/offline`}>Offline status</Link>
          <span>•</span>
          <Link to={`/w/${workspaceId}/recovery`}>Access and recovery</Link>
        </div>
      </div>

      {!writable ? (
        <p className="notes-status-region">
          This workspace is read-only for viewers. File editing and membership
          controls are hidden for this role.
        </p>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <WorkspaceMembers
          workspaceId={workspaceId}
          role={role}
          onChanged={onChanged}
        />
        {role === 'owner' ? (
          <WorkspaceOwnerControls
            workspace={{ workspaceId, name, role, personal }}
            onChanged={onChanged}
          />
        ) : null}
      </div>
    </main>
  );
}

/** One note: unknown, purged, empty, and readable states stay distinct. */
export function NoteView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const fileId = typeof params.fileId === 'string' ? params.fileId : null;
  const { state } = useWorkspaces();
  const session = useSession();
  const store = useLocalStore();

  if (workspaceId === null || fileId === null)
    return (
      <main>
        <h1>Note not found</h1>
        <p>
          The address names no file in this workspace. It may be removed, or the
          address may be wrong. This is not an empty note.
        </p>
      </main>
    );

  const role =
    state.status === 'ready'
      ? (findWorkspace(state.workspaces, workspaceId)?.role ?? null)
      : null;
  const accountId = session.account?.accountId ?? null;
  if (accountId === null)
    return (
      <main>
        <StatusRegion message="Loading the note." />
      </main>
    );

  return (
    <>
      <div className="notes-doc-nav-links" style={{ marginBottom: '12px' }}>
        <Link to={`/w/${workspaceId}/notes/${fileId}/history`}>
          <HistoryIcon size={14} />
          <span>History and checkpoints</span>
        </Link>
        <span>•</span>
        <Link to={`/w/${workspaceId}/conflicts?fileId=${fileId}`}>
          <span>Conflicts of this file</span>
        </Link>
      </div>
      {role === 'owner' || role === 'admin' ? (
        <Suspense fallback={<StatusRegion message="Loading sharing tools." />}>
          <SharingPanel workspaceId={workspaceId} fileId={fileId} />
        </Suspense>
      ) : null}
      <Suspense fallback={<StatusRegion message="Loading the editor." />}>
        <NoteEditorLoader
          store={store.store}
          accountId={accountId}
          workspaceId={workspaceId}
          fileId={fileId}
          role={role}
        />
      </Suspense>
    </>
  );
}
