/**
 * Application shell: responsive layout, workspace navigation, and file tree.
 *
 * The shell owns routing chrome only: a header, a sidebar that becomes a
 * drawer on phones, the workspace selector, the file tree, the
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
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { listFiles, type WorkspaceFileSummary } from '@notesapp/api-client';
import {
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
  TrashIcon,
  UserIcon,
  WorkspaceIcon,
} from '@notesapp/ui';
import {
  problemMessage,
  SyncProvider,
  useLocalStore,
  useSession,
  useTheme,
  useWorkspaceSync,
} from '../app.tsx';
import { AttentionLink, useAttentionCount } from './attention-link.tsx';
import { canWrite, findWorkspace, useWorkspaces } from './workspaces.tsx';
import { NewNoteButton } from './new-note.tsx';
import { displayNoteName } from './note-name.ts';
import { BacklinksPanel, OutlinePanel } from './backlinks.tsx';
import { QuickOpenDialog, SearchDialog } from './search.tsx';
import { DeleteNoticeBar, DeleteNoticeProvider } from './trash.tsx';
import { mergeFileSummaries, useLocalQuery } from '../local-state.ts';

const NoteEditorLoader = lazy(async () => ({
  default: (await import('./note-editor.tsx')).NoteEditorLoader,
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

/** Loads one merged server and local file list for shell navigation. */
function useWorkspaceFiles(workspaceId: string | null): {
  readonly files: readonly WorkspaceFileSummary[];
  readonly loading: boolean;
} {
  const session = useSession();
  const store = useLocalStore();
  const [serverFiles, setServerFiles] = useState<
    readonly WorkspaceFileSummary[]
  >([]);
  const [loading, setLoading] = useState(workspaceId !== null);
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
    if (workspaceId === null) {
      setServerFiles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadAllFiles(workspaceId)
      .then((loaded) => {
        if (!cancelled) setServerFiles(loaded.files);
      })
      .catch(() => {
        if (!cancelled) setServerFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return {
    files: useMemo(
      () => mergeFileSummaries(serverFiles, localFiles.value),
      [serverFiles, localFiles.value],
    ),
    loading,
  };
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
    return <p className="my-1 px-2 text-control text-muted">No files yet.</p>;
  }

  return (
    <ul className="m-0 list-none space-y-0.5 p-0">
      {nodes.map((node) => {
        if (node.kind === 'file') {
          const isActive = node.file.fileId === activeFileId;
          return (
            <li key={node.file.fileId}>
              <Link
                className={`flex min-h-8 items-center gap-2 rounded-md px-2 text-control no-underline transition-colors ${isActive ? 'bg-active text-strong' : 'text-muted hover:bg-hover hover:text-strong'}`}
                to={`/w/${workspaceId}/notes/${node.file.fileId}`}
                onClick={onNavigate}
                title={node.file.path}
                aria-current={isActive ? 'page' : undefined}
              >
                <span
                  className="inline-flex shrink-0 items-center"
                  aria-hidden="true"
                >
                  <FileTextIcon size={14} />
                </span>
                <span className="min-w-0 truncate">
                  {displayNoteName(node.basename)}
                </span>
              </Link>
            </li>
          );
        }

        const isOpen = openFolders.has(node.fullPath);
        return (
          <li key={`folder:${node.fullPath}`}>
            <button
              type="button"
              className="flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-left text-control text-muted hover:bg-hover hover:text-strong focus-visible:outline-2 focus-visible:outline-focus"
              onClick={() => onToggleFolder(node.fullPath)}
              aria-expanded={isOpen}
            >
              <span
                className="inline-flex shrink-0 items-center"
                aria-hidden="true"
              >
                {isOpen ? (
                  <ChevronDownIcon size={13} />
                ) : (
                  <ChevronRightIcon size={13} />
                )}
              </span>
              <span
                className="inline-flex shrink-0 items-center"
                aria-hidden="true"
              >
                {isOpen ? (
                  <FolderOpenIcon size={15} />
                ) : (
                  <FolderIcon size={15} />
                )}
              </span>
              <span className="min-w-0 truncate">{node.name}</span>
            </button>
            {isOpen ? (
              <div className="ml-3 border-l border-edge-subtle pl-1">
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

/** The sidebar: workspace switcher, file tree, and contextual note panels. */
function Sidebar({
  workspaceId,
  files,
  filesLoading,
  onNavigate,
}: {
  readonly workspaceId: string | null;
  readonly files: readonly WorkspaceFileSummary[];
  readonly filesLoading: boolean;
  readonly onNavigate: () => void;
}): ReactNode {
  const { state } = useWorkspaces();
  const params = useParams();
  const fileId = typeof params.fileId === 'string' ? params.fileId : null;
  const session = useSession();
  const store = useLocalStore();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);
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
    const allFolders = new Set<string>();
    for (const file of files) {
      const parts = file.path.split('/');
      let current = '';
      for (let index = 0; index < parts.length - 1; index += 1) {
        const segment = parts[index] ?? '';
        if (segment === '') continue;
        current = current === '' ? segment : `${current}/${segment}`;
        allFolders.add(current);
      }
    }
    setOpenFolders(allFolders);
  }, [files, workspaceId]);

  useEffect(() => {
    if (!switcherOpen) return;
    const close = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && !switcherRef.current?.contains(target))
        setSwitcherOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSwitcherOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [switcherOpen]);

  const canEdit = activeWorkspace !== null && canWrite(activeWorkspace.role);

  return (
    <>
      <div
        className="relative border-b border-edge-subtle p-2"
        ref={switcherRef}
      >
        <button
          type="button"
          className="flex min-h-9 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-ui font-semibold text-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
          aria-haspopup="menu"
          aria-expanded={switcherOpen}
          onClick={() => setSwitcherOpen((open) => !open)}
        >
          <WorkspaceIcon size={16} />
          <span className="min-w-0 flex-1 truncate">
            {activeWorkspace?.name ?? 'Workspace'}
          </span>
          <ChevronDownIcon size={14} />
        </button>
        {switcherOpen && state.status === 'ready' ? (
          <div
            className="absolute left-2 right-2 top-full z-40 mt-1 rounded-lg border border-edge-subtle bg-card p-1 shadow-lg"
            role="menu"
          >
            {state.workspaces.map((entry) => (
              <Link
                key={entry.workspaceId}
                role="menuitem"
                className="flex min-h-8 items-center gap-2 rounded-md px-2 text-control text-strong no-underline hover:bg-hover"
                aria-current={
                  entry.workspaceId === workspaceId ? 'page' : undefined
                }
                to={`/w/${entry.workspaceId}`}
                onClick={() => {
                  setSwitcherOpen(false);
                  onNavigate();
                }}
              >
                <WorkspaceIcon size={14} />
                <span>{entry.name}</span>
              </Link>
            ))}
            <Link
              role="menuitem"
              className="mt-1 flex min-h-8 items-center gap-2 border-t border-edge-subtle px-2 pt-1 text-control text-accent no-underline hover:bg-hover"
              to="/workspaces/new"
              onClick={() => {
                setSwitcherOpen(false);
                onNavigate();
              }}
            >
              <span aria-hidden="true">+</span>
              <span>Create new workspace</span>
            </Link>
          </div>
        ) : null}
      </div>

      {workspaceId !== null && canEdit && session.account !== null ? (
        <div className="px-2 py-2">
          <NewNoteButton
            store={store.store}
            accountId={session.account.accountId}
            workspaceId={workspaceId}
            variant="primary"
            className="w-full"
          />
        </div>
      ) : null}

      {workspaceId === null ? null : (
        <>
          <section
            aria-labelledby="tree-heading"
            className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
          >
            <h2
              id="tree-heading"
              className="mb-1 flex items-center justify-between px-2 text-control font-semibold uppercase tracking-wide text-muted"
            >
              <span>Files</span>
              <span className="rounded-full bg-hover px-1.5 py-0.5 text-xs font-medium">
                {files.length}
              </span>
            </h2>
            {filesLoading ? (
              <StatusRegion message="Loading files." />
            ) : (
              <TreeView
                nodes={buildFileTree(files)}
                workspaceId={workspaceId}
                activeFileId={fileId}
                openFolders={openFolders}
                onToggleFolder={toggleFolder}
                onNavigate={onNavigate}
              />
            )}
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
  const [quickOpen, setQuickOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const drawerWasOpenRef = useRef(false);
  const session = useSession();
  const store = useLocalStore();
  const { resolved, setChoice } = useTheme();
  const { state: workspaceState } = useWorkspaces();
  const workspaceFiles = useWorkspaceFiles(workspaceId);

  const activeWorkspace = useMemo(() => {
    if (workspaceState.status !== 'ready' || workspaceId === null) return null;
    return findWorkspace(workspaceState.workspaces, workspaceId);
  }, [workspaceState, workspaceId]);

  const canEdit = activeWorkspace !== null && canWrite(activeWorkspace.role);
  const accountId = session.account?.accountId ?? null;
  const sync = useWorkspaceSync(store.store, accountId, workspaceId);
  const syncMessage = sync.message;
  const attentionCount = useAttentionCount(store.store, accountId, workspaceId);
  const showSyncProblem =
    syncMessage.includes('stopped') ||
    syncMessage.includes('retries') ||
    syncMessage.includes('needs attention') ||
    syncMessage.includes('paused') ||
    syncMessage.includes('lost');

  useEffect(() => {
    if (workspaceId !== null) {
      window.localStorage.setItem('notesapp:last-workspace-id', workspaceId);
    }
  }, [workspaceId]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (workspaceId !== null) setQuickOpen(true);
      } else if (event.key === 'Escape') {
        setQuickOpen(false);
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [workspaceId]);

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
    <SyncProvider value={sync}>
      <DeleteNoticeProvider>
        <div className="min-h-dvh bg-app text-ink">
          <a
            className="fixed left-2 top-2 z-50 -translate-y-20 rounded-md bg-accent-fill px-3 py-2 text-on-accent focus:translate-y-0"
            href="#notes-content"
          >
            Skip to content
          </a>

          <header className="sticky top-0 z-30 flex h-13 items-center gap-3 border-b border-edge-subtle bg-card px-3">
            <Button
              buttonRef={menuButtonRef}
              variant="ghost"
              size="sm"
              className="md:hidden"
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
              <span>Notesapp</span>
            </Link>

            {workspaceId !== null ? (
              <SearchDialog
                store={store.store}
                accountId={accountId}
                workspaceId={workspaceId}
                onNavigate={() => setDrawerOpen(false)}
              />
            ) : null}

            <span className="min-w-0 flex-1" />

            <div className="flex shrink-0 items-center gap-1">
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
              />

              <Link
                className="inline-flex size-8 items-center justify-center rounded-lg text-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
                to="/settings"
                aria-label="Account settings"
                title="Account settings"
              >
                <UserIcon size={16} />
              </Link>
            </div>
          </header>

          <div
            className={`${drawerOpen ? 'fixed inset-0 z-30 bg-black/50 md:hidden' : 'hidden'}`}
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />

          <aside
            ref={sidebarRef}
            id="notes-sidebar"
            className={`fixed bottom-0 left-0 top-13 z-40 flex w-64 flex-col border-r border-edge-subtle bg-surface transition-transform md:translate-x-0 ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
            aria-label="Notes navigation"
            aria-modal={drawerOpen ? true : undefined}
            role={drawerOpen ? 'dialog' : undefined}
          >
            <Sidebar
              workspaceId={workspaceId}
              files={workspaceFiles.files}
              filesLoading={workspaceFiles.loading}
              onNavigate={() => setDrawerOpen(false)}
            />
            <div className="border-t border-edge-subtle p-2">
              {workspaceId === null ? null : (
                <Link
                  className="flex min-h-8 items-center gap-2 rounded-md px-2 text-control text-muted no-underline transition-colors hover:bg-hover hover:text-strong"
                  to={`/w/${workspaceId}/trash`}
                  onClick={() => setDrawerOpen(false)}
                  aria-current={
                    location.pathname === `/w/${workspaceId}/trash`
                      ? 'page'
                      : undefined
                  }
                >
                  <span
                    className="inline-flex shrink-0 items-center"
                    aria-hidden="true"
                  >
                    <TrashIcon size={14} />
                  </span>
                  <span>Trash</span>
                </Link>
              )}
              {workspaceId === null ? null : (
                <AttentionLink
                  workspaceId={workspaceId}
                  count={attentionCount}
                />
              )}
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted hover:bg-hover hover:text-strong focus-visible:outline-2 focus-visible:outline-focus"
                onClick={() => setShortcutsOpen(true)}
              >
                Keyboard shortcuts
              </button>
              {showSyncProblem ? <StatusRegion message={syncMessage} /> : null}
              {store.error !== null ? (
                <p className="my-1 text-control text-danger" role="alert">
                  {store.error}
                </p>
              ) : null}
            </div>
          </aside>

          <div id="notes-content" className="min-h-0 md:pl-64">
            <Outlet />
          </div>

          <DeleteNoticeBar />

          <QuickOpenDialog
            open={quickOpen}
            workspaceId={workspaceId}
            files={workspaceFiles.files}
            onOpenChange={setQuickOpen}
          />
          {shortcutsOpen ? (
            <div
              className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-24"
              role="presentation"
              onMouseDown={(event): void => {
                if (event.target === event.currentTarget)
                  setShortcutsOpen(false);
              }}
            >
              <section
                className="w-full max-w-md rounded-xl border border-edge-subtle bg-card p-5 text-ink shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="keyboard-shortcuts-title"
              >
                <h2
                  className="m-0 text-lg font-semibold text-strong"
                  id="keyboard-shortcuts-title"
                >
                  Keyboard shortcuts
                </h2>
                <dl className="my-4 space-y-2 text-ui">
                  <div className="flex justify-between gap-4">
                    <dt>Open note</dt>
                    <dd>Cmd or Ctrl + O</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Save note</dt>
                    <dd>Cmd or Ctrl + S</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Toggle task</dt>
                    <dd>Cmd or Ctrl + Enter</dd>
                  </div>
                </dl>
                <Button
                  variant="secondary"
                  onClick={() => setShortcutsOpen(false)}
                >
                  Close
                </Button>
              </section>
            </div>
          ) : null}
        </div>
      </DeleteNoticeProvider>
    </SyncProvider>
  );
}

/** One workspace and its files. */
export function WorkspaceView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const { state } = useWorkspaces();

  if (workspaceId === null)
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Workspace not found
        </h1>
        <p>The address names no workspace.</p>
      </main>
    );
  if (state.status === 'loading')
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <StatusRegion message="Loading the workspace." />
      </main>
    );
  if (state.status === 'error')
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Workspace
        </h1>
        <p className="text-control text-danger" role="alert">
          {state.message}
        </p>
      </main>
    );

  const workspace = findWorkspace(state.workspaces, workspaceId);
  if (workspace === null)
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Workspace not found
        </h1>
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
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-semibold text-strong">{name}</h1>
          <p className="mb-0 mt-1 text-control text-muted">
            {activeNotes.length} {activeNotes.length === 1 ? 'note' : 'notes'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/w/${workspaceId}/settings`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-edge px-2.5 text-control text-strong no-underline hover:bg-hover"
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
        <div className="mt-6 rounded-xl border border-dashed border-edge-subtle bg-card px-4 py-16 text-center text-muted">
          <FileTextIcon size={36} className="mx-auto" />
          <p className="mb-4 mt-3 text-base text-strong">
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
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                className="flex flex-col gap-2 rounded-xl border border-edge-subtle bg-card p-4 text-ink no-underline shadow-sm transition hover:border-edge hover:shadow-md"
              >
                <div className="flex items-center gap-2 text-ui font-semibold text-strong">
                  <FileTextIcon size={16} />
                  <span>{displayNoteName(basename)}</span>
                </div>
                <div className="flex flex-col gap-1 text-xs text-muted">
                  <span>{displayNoteName(file.path)}</span>
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
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Note not found
        </h1>
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
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <StatusRegion message="Loading the note." />
      </main>
    );

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 pb-20 sm:p-6">
      <div className="mb-3 flex items-center justify-between text-control">
        <Link
          className="inline-flex items-center gap-1 text-accent no-underline hover:underline"
          to={`/w/${workspaceId}/notes/${fileId}/history`}
        >
          <HistoryIcon size={14} />
          <span>History and checkpoints</span>
        </Link>
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
