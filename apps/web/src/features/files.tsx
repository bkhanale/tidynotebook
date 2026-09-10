/**
 * The one file list of the open notes area.
 *
 * Every screen that needs the notes reads this provider. The list operation
 * therefore runs once for the area instead of once for the sidebar and once
 * for the note list, and both surfaces always agree.
 *
 * The list holds notes only. An attachment is a stored file of the same
 * workspace, but it is not a note: it has no editor and no name that a
 * person chose, so it never reaches the tree, the note list, or the command
 * palette.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { listFiles, type WorkspaceFileSummary } from '@notesapp/api-client';
import type { LocalFileSummary, LocalStore } from '@notesapp/sync';
import { problemMessage, useLocalStore, useSession } from '../app.tsx';
import { useLocalQuery } from '../local-state.ts';
import { mergeNotes, type NoteSummary } from './note-list.ts';
import { folderPaths } from './note-name.ts';

/** What every screen reads about the notes of the open area. */
export type FilesValue = {
  readonly notes: readonly NoteSummary[];
  readonly loading: boolean;
  /** Every folder that the note paths imply, sorted by path. */
  readonly folders: readonly string[];
  /** Reads the server list again, for example after a restore. */
  readonly reload: () => void;
};

const FilesContext = createContext<FilesValue>({
  notes: [],
  loading: true,
  folders: [],
  reload: () => {},
});

/** Reads the notes of the open area. */
export function useFiles(): FilesValue {
  return useContext(FilesContext);
}

/**
 * Every live note of the area, in the order of the folder tree.
 *
 * The server sorts and pages the listing, so each page continues the
 * previous one through its cursor instead of scanning from the front. The
 * sidebar shows a folder tree, so it asks for the path order.
 */
async function loadAllFiles(
  workspaceId: string,
): Promise<readonly WorkspaceFileSummary[]> {
  const files: WorkspaceFileSummary[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { readonly cursor?: string } =
      cursor === null ? {} : { cursor };
    const result = await listFiles({
      path: { workspaceId },
      query: { ...page, limit: 100, sort: 'path' },
    });
    if (result.error !== undefined || result.data === undefined)
      throw new Error(problemMessage(result.error));
    files.push(...result.data.files);
    if (result.data.nextCursor === null) break;
    cursor = result.data.nextCursor;
  }
  return files;
}

/** Publishes the one note list of the open area to every screen below. */
export function FilesProvider({
  workspaceId,
  children,
}: {
  readonly workspaceId: string;
  readonly children: ReactNode;
}): ReactNode {
  const session = useSession();
  const store = useLocalStore();
  const [serverFiles, setServerFiles] = useState<
    readonly WorkspaceFileSummary[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const emptyLocalFiles = useMemo<readonly LocalFileSummary[]>(() => [], []);
  const localFiles = useLocalQuery(
    store.store,
    session.account?.accountId ?? null,
    workspaceId,
    (activeStore: LocalStore, accountId: string, activeWorkspace: string) =>
      activeStore.listLocalFiles(accountId, activeWorkspace),
    emptyLocalFiles,
    (change) =>
      change.kind === 'draft' ||
      change.kind === 'queue' ||
      change.kind === 'file' ||
      change.kind === 'reset',
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setServerFiles([]);
    void loadAllFiles(workspaceId)
      .then((loaded) => {
        if (!cancelled) setServerFiles(loaded);
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
  }, [workspaceId, generation]);

  const notes = useMemo(
    () => mergeNotes(serverFiles, localFiles.value),
    [serverFiles, localFiles.value],
  );

  const reload = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  const value = useMemo<FilesValue>(
    () => ({
      notes,
      loading,
      folders: folderPaths(notes.map((note) => note.path)),
      reload,
    }),
    [notes, loading, reload],
  );

  return (
    <FilesContext.Provider value={value}>{children}</FilesContext.Provider>
  );
}

const openFoldersKey = 'notesapp.open-folders:';

/** Reads the folders a person left open, without trusting the stored shape. */
function readOpenFolders(workspaceId: string): ReadonlySet<string> {
  try {
    const stored = window.localStorage.getItem(
      `${openFoldersKey}${workspaceId}`,
    );
    if (stored === null) return new Set();
    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((entry) => typeof entry === 'string'));
  } catch {
    return new Set();
  }
}

/**
 * Keeps the open folders of the tree across refreshes and reloads.
 *
 * The state is a person choice, so a file list change never rewrites it. A
 * folder that the person collapsed stays collapsed when a keystroke changes
 * a local file summary, and it is still collapsed after a page reload.
 */
export function useOpenFolders(workspaceId: string): {
  readonly openFolders: ReadonlySet<string>;
  readonly toggleFolder: (path: string) => void;
  readonly openFolder: (path: string) => void;
} {
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(() =>
    readOpenFolders(workspaceId),
  );

  useEffect(() => {
    setOpenFolders(readOpenFolders(workspaceId));
  }, [workspaceId]);

  /** Stores the open set so a reload keeps the shape of the tree. */
  const remember = (next: ReadonlySet<string>): void => {
    try {
      window.localStorage.setItem(
        `${openFoldersKey}${workspaceId}`,
        JSON.stringify([...next]),
      );
    } catch {
      // The tree still works when browser preference storage fails.
    }
  };

  const toggleFolder = useCallback(
    (path: string): void => {
      setOpenFolders((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        remember(next);
        return next;
      });
    },
    [workspaceId],
  );

  const openFolder = useCallback(
    (path: string): void => {
      if (path === '') return;
      setOpenFolders((current) => {
        if (current.has(path)) return current;
        const next = new Set(current);
        next.add(path);
        remember(next);
        return next;
      });
    },
    [workspaceId],
  );

  return { openFolders, toggleFolder, openFolder };
}
