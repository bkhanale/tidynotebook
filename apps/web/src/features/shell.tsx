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
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { listFiles, type WorkspaceFileSummary } from '@notesapp/api-client';
import { Button, CollapsibleSection, StatusRegion } from '@notesapp/ui';
import '../shell.css';
import {
  problemMessage,
  useLocalSnapshotStatus,
  useLocalStore,
  useSession,
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
type TreeNode =
  | { readonly kind: 'file'; readonly file: WorkspaceFileSummary }
  | {
      readonly kind: 'folder';
      readonly name: string;
      readonly children: readonly TreeNode[];
    };

/** Groups flat file paths into a folder tree. */
export function buildFileTree(
  files: readonly WorkspaceFileSummary[],
): readonly TreeNode[] {
  type MutableFolder = {
    readonly folders: Map<string, MutableFolder>;
    readonly files: WorkspaceFileSummary[];
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
    current.files.push(file);
  }
  const render = (folder: MutableFolder): readonly TreeNode[] => {
    const folders = [...folder.folders.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([name, child]): TreeNode => ({
        kind: 'folder',
        name,
        children: render(child),
      }));
    const leaves = folder.files.map((file): TreeNode => ({
      kind: 'file',
      file,
    }));
    return [...folders, ...leaves];
  };
  return render(root);
}

/** Renders one tree node as nested lists. */
function TreeView({
  nodes,
  workspaceId,
  onNavigate,
}: {
  readonly nodes: readonly TreeNode[];
  readonly workspaceId: string;
  readonly onNavigate: () => void;
}): ReactNode {
  if (nodes.length === 0) return <p>No files yet.</p>;
  return (
    <ul className="notes-tree">
      {nodes.map((node) =>
        node.kind === 'file' ? (
          <li key={node.file.fileId}>
            <Link
              className="notes-tree-link"
              to={`/w/${workspaceId}/notes/${node.file.fileId}`}
              onClick={onNavigate}
            >
              {node.file.path}
            </Link>
          </li>
        ) : (
          <li key={`folder:${node.name}`}>
            <span className="notes-tree-folder">{node.name}/</span>
            <TreeView
              nodes={node.children}
              workspaceId={workspaceId}
              onNavigate={onNavigate}
            />
          </li>
        ),
      )}
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
  const local = useLocalStore();
  const [filter, setFilter] = useState('');
  const [files, setFiles] = useState<readonly WorkspaceFileSummary[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(false);

  useEffect(() => {
    if (workspaceId === null) {
      setFiles([]);
      return;
    }
    const activeWorkspace = workspaceId;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const loaded = await loadAllFiles(activeWorkspace);
        if (!cancelled) setFiles(loaded.files);
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

  return (
    <div className="notes-sidebar-body">
      <nav aria-label="Workspaces">
        <h2>Workspace</h2>
        {state.status === 'ready' ? (
          <ul>
            {state.workspaces.map((entry) => (
              <li key={entry.workspaceId}>
                <Link
                  className="notes-tree-link"
                  to={`/w/${entry.workspaceId}`}
                  onClick={onNavigate}
                  aria-current={
                    entry.workspaceId === workspaceId ? 'page' : undefined
                  }
                >
                  {entry.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <StatusRegion message="Loading workspaces." />
        )}
      </nav>
      {workspaceId === null ? null : (
        <>
          <SearchDialog
            store={local.store}
            accountId={session.account?.accountId ?? null}
            workspaceId={workspaceId}
            onNavigate={onNavigate}
          />
          <section aria-labelledby="recent-heading">
            <h2 id="recent-heading">Recent files</h2>
            <ul>
              {recentFiles(files).map((file) => (
                <li key={file.fileId}>
                  <Link
                    className="notes-tree-link"
                    to={`/w/${workspaceId}/notes/${file.fileId}`}
                    onClick={onNavigate}
                  >
                    {file.path}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="tree-heading">
            <h2 id="tree-heading">Files</h2>
            <label className="notes-label" htmlFor="notes-filter">
              Filter files
            </label>
            <input
              id="notes-filter"
              className="notes-input"
              type="text"
              value={filter}
              placeholder="Type to filter"
              onChange={(event): void => {
                setFilter(event.target.value);
              }}
            />
            <TreeView
              nodes={buildFileTree(visible)}
              workspaceId={workspaceId}
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
    </div>
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

  return (
    <div className={`notes-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <a className="notes-skip-link" href="#notes-content">
        Skip to content
      </a>
      <header className="notes-header">
        <Button
          variant="secondary"
          label={drawerOpen ? 'Close navigation' : 'Open navigation'}
          onClick={() => {
            setDrawerOpen((open) => !open);
          }}
        >
          Menu
        </Button>
        <Link className="notes-brand" to="/">
          Notesapp
        </Link>
        <span className="notes-header-spacer" />
        <Link className="notes-tree-link" to="/settings">
          {session.account?.email ?? 'Account'}
        </Link>
      </header>
      <aside
        id="notes-sidebar"
        className="notes-sidebar"
        aria-label="Notes navigation"
      >
        <Sidebar
          workspaceId={workspaceId}
          onNavigate={() => setDrawerOpen(false)}
        />
      </aside>
      <div id="notes-content" className="notes-content">
        <Outlet />
        <footer>
          <StatusRegion message={syncMessage} />
          {localMessage !== '' ? <StatusRegion message={localMessage} /> : null}
          {store.error !== null ? (
            <p className="notes-status-error" role="alert">
              {store.error}
            </p>
          ) : null}
        </footer>
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
      <h1>{name}</h1>
      <p>
        Role: {role}
        {personal ? ' (personal)' : ''}
      </p>
      {!writable ? (
        <p>
          This workspace is read-only for viewers. File editing and membership
          controls are hidden for this role.
        </p>
      ) : null}
      {writable && session.account !== null ? (
        <NewNoteButton
          store={store.store}
          accountId={session.account.accountId}
          workspaceId={workspaceId}
        />
      ) : null}
      <p>Open a note from the sidebar to edit it in the one-pane editor.</p>
      <p>
        <Link to={`/w/${workspaceId}/conflicts`}>Conflicts.</Link>
        {' | '}
        <Link to={`/w/${workspaceId}/purge`}>Deletion and purge.</Link>
        {' | '}
        <Link to={`/w/${workspaceId}/offline`}>Offline status.</Link>
        {' | '}
        <Link to={`/w/${workspaceId}/recovery`}>Access and recovery.</Link>
      </p>
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
      <p>
        <Link to={`/w/${workspaceId}/notes/${fileId}/history`}>
          History, checkpoints, and restore.
        </Link>
        {' | '}
        <Link to={`/w/${workspaceId}/conflicts?fileId=${fileId}`}>
          Conflicts of this file.
        </Link>
      </p>
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
