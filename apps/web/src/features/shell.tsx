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
  SettingsIcon,
  StatusRegion,
  SunIcon,
  UserIcon,
  WorkspaceIcon,
} from '@notesapp/ui';
import {
  problemMessage,
  useLocalSnapshotStatus,
  useLocalStore,
  useSession,
  useTheme,
  useWorkspaceSync,
} from '../app.tsx';
import { canWrite, findWorkspace, useWorkspaces } from './workspaces.tsx';
import { NewNoteButton } from './new-note.tsx';
import { BacklinksPanel, OutlinePanel } from './backlinks.tsx';
import { SearchDialog } from './search.tsx';
import { mergeFileSummaries, useLocalQuery } from '../local-state.ts';

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
  const [serverFiles, setServerFiles] = useState<
    readonly WorkspaceFileSummary[]
  >([]);
  const emptyLocalFiles = useMemo(() => [], []);
  const localFiles = useLocalQuery(
    store.store,
    session.account?.accountId ?? null,
    workspaceId,
    (activeStore, accountId, activeWorkspace) =>
      activeStore.listLocalFiles(accountId, activeWorkspace),
    emptyLocalFiles,
    (change) =>
      change.kind === 'draft' ||
      change.kind === 'queue' ||
      change.kind === 'file' ||
      change.kind === 'conflict' ||
      change.kind === 'reset',
  );
  const files = useMemo(
    () => mergeFileSummaries(serverFiles, localFiles.value),
    [serverFiles, localFiles.value],
  );
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
      setServerFiles([]);
      return;
    }
    const activeWs = workspaceId;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const loaded = await loadAllFiles(activeWs);
        if (!cancelled) {
          setServerFiles(loaded.files);
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
        if (!cancelled) setServerFiles([]);
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
  const navigate = useNavigate();
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const drawerWasOpenRef = useRef(false);
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
    if (workspaceId !== null) {
      window.localStorage.setItem('notesapp:last-workspace-id', workspaceId);
    }
  }, [workspaceId]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

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
          buttonRef={menuButtonRef}
          variant="ghost"
          size="sm"
          className="notes-header-menu-btn"
          label={drawerOpen ? 'Close navigation' : 'Open navigation'}
          icon={<MenuIcon size={18} />}
          ariaControls="notes-sidebar"
          ariaExpanded={drawerOpen}
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
          {workspaceState.status === 'ready' &&
          workspaceState.workspaces.length > 0 ? (
            <select
              className="notes-workspace-select"
              aria-label="Workspace"
              value={workspaceId ?? ''}
              onChange={(event) => {
                const targetId = event.target.value;
                if (targetId !== '') {
                  window.localStorage.setItem(
                    'notesapp:last-workspace-id',
                    targetId,
                  );
                  void navigate(`/w/${targetId}`);
                }
              }}
            >
              {workspaceId === null ? (
                <option value="" disabled>
                  Select workspace
                </option>
              ) : null}
              {workspaceState.workspaces.map((ws) => (
                <option key={ws.workspaceId} value={ws.workspaceId}>
                  {ws.name}
                </option>
              ))}
            </select>
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
        ref={sidebarRef}
        id="notes-sidebar"
        className="notes-sidebar"
        aria-label="Notes navigation"
        aria-modal={drawerOpen ? true : undefined}
        role={drawerOpen ? 'dialog' : undefined}
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
  const { state } = useWorkspaces();

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
    <WorkspaceNotesView
      workspaceId={workspace.workspaceId}
      name={workspace.name}
      role={workspace.role}
    />
  );
}

/** The workspace notes screen: displays only notes when the workspace is open. */
function WorkspaceNotesView({
  workspaceId,
  name,
  role,
}: {
  readonly workspaceId: string;
  readonly name: string;
  readonly role: 'owner' | 'admin' | 'editor' | 'viewer';
}): ReactNode {
  const writable = canWrite(role);
  const session = useSession();
  const store = useLocalStore();
  const [serverFiles, setServerFiles] = useState<
    readonly WorkspaceFileSummary[]
  >([]);
  const [loading, setLoading] = useState(true);
  const emptyLocalFiles = useMemo(() => [], []);
  const localFiles = useLocalQuery(
    store.store,
    session.account?.accountId ?? null,
    workspaceId,
    (activeStore, accountId, activeWorkspace) =>
      activeStore.listLocalFiles(accountId, activeWorkspace),
    emptyLocalFiles,
    (change) =>
      change.kind === 'draft' ||
      change.kind === 'queue' ||
      change.kind === 'file' ||
      change.kind === 'conflict' ||
      change.kind === 'reset',
  );

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const loaded = await loadAllFiles(workspaceId);
        if (!cancelled) {
          setServerFiles(loaded.files);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setServerFiles([]);
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const allFiles = useMemo(
    () => mergeFileSummaries(serverFiles, localFiles.value),
    [serverFiles, localFiles.value],
  );

  const activeNotes = useMemo(
    () => allFiles.filter((f) => f.kind === 'note'),
    [allFiles],
  );

  return (
    <main
      style={{ padding: '24px 32px', maxWidth: '1080px', margin: '0 auto' }}
    >
      <div className="notes-workspace-notes-header">
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600 }}>
            {name}
          </h1>
          <p
            style={{
              margin: '4px 0 0 0',
              color: 'var(--notes-text-muted)',
              fontSize: '0.9rem',
            }}
          >
            {activeNotes.length} {activeNotes.length === 1 ? 'note' : 'notes'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <Link
            to={`/w/${workspaceId}/settings`}
            className="notes-btn notes-btn-secondary notes-btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              textDecoration: 'none',
            }}
          >
            <SettingsIcon size={14} />
            <span>Settings</span>
          </Link>
          {writable && session.account !== null ? (
            <NewNoteButton
              store={store.store}
              accountId={session.account.accountId}
              workspaceId={workspaceId}
              variant="primary"
              size="sm"
            />
          ) : null}
        </div>
      </div>

      {loading ? (
        <StatusRegion message="Loading notes." />
      ) : activeNotes.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '64px 16px',
            color: 'var(--notes-text-muted)',
            background: 'var(--notes-surface-card)',
            border: '1px dashed var(--notes-border-subtle)',
            borderRadius: 'var(--notes-radius-lg)',
            marginTop: '24px',
          }}
        >
          <FileTextIcon size={36} className="notes-empty-icon" />
          <p
            style={{
              fontSize: '1.1rem',
              margin: '12px 0 16px 0',
              color: 'var(--notes-text-strong)',
            }}
          >
            No notes yet in this workspace.
          </p>
          {writable && session.account !== null ? (
            <NewNoteButton
              store={store.store}
              accountId={session.account.accountId}
              workspaceId={workspaceId}
              variant="primary"
            />
          ) : null}
        </div>
      ) : (
        <div className="notes-notes-grid" style={{ marginTop: '24px' }}>
          {activeNotes.map((file) => {
            const basename = file.path.split('/').at(-1) ?? file.path;
            const updatedDate = new Date(file.updatedAt).toLocaleDateString(
              undefined,
              {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              },
            );
            return (
              <Link
                key={file.fileId}
                to={`/w/${workspaceId}/notes/${file.fileId}`}
                className="notes-note-list-card"
              >
                <div className="notes-note-list-card-title">
                  <FileTextIcon size={16} />
                  <span>{basename}</span>
                </div>
                <div className="notes-note-list-card-meta">
                  <span>{file.path}</span>
                  <span>{updatedDate}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
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
    <main className="notes-note-view">
      <div
        className="notes-doc-nav-links"
        style={{
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link to={`/w/${workspaceId}/notes/${fileId}/history`}>
          <HistoryIcon size={14} />
          <span>History and checkpoints</span>
        </Link>
        {role === 'owner' || role === 'admin' ? (
          <Suspense fallback={null}>
            <SharingPanel workspaceId={workspaceId} fileId={fileId} />
          </Suspense>
        ) : null}
      </div>
      <Suspense fallback={<StatusRegion message="Loading the editor." />}>
        <NoteEditorLoader
          store={store.store}
          accountId={accountId}
          workspaceId={workspaceId}
          fileId={fileId}
          role={role}
        />
      </Suspense>
    </main>
  );
}
