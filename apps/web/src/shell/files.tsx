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
import {
  pruneEmptyFolders,
  removeEmptyFolders as removeEmptyFoldersPure,
  rewriteEmptyFolders,
  withEmptyFolder,
} from '../lib/empty-folders.ts';
import { mergeNotes, type NoteSummary } from '../lib/note-list.ts';
import { folderPaths } from '../lib/note-name.ts';

/** What every screen reads about the notes of the open area. */
export type FilesValue = {
  readonly notes: readonly NoteSummary[];
  readonly loading: boolean;
  /** Every folder that the note paths imply, sorted by path. */
  readonly folders: readonly string[];
  /**
   * Folders that a person made and that hold no note yet.
   *
   * A folder is only a part of a note path, so the server cannot describe an
   * empty one. This device remembers it until a note is made or moved into
   * it, and no placeholder note is created.
   */
  readonly emptyFolders: readonly string[];
  /** Remembers one more empty folder on this device. */
  readonly addEmptyFolder: (folder: string) => void;
  /** Follows a folder rename or move with the remembered empty folders. */
  readonly moveEmptyFolders: (fromFolder: string, toFolder: string) => void;
  /** Forgets a folder and everything below it after a folder left the tree. */
  readonly removeEmptyFolders: (folder: string) => void;
  /** Reads the server list again, for example after a restore. */
  readonly reload: () => void;
};

const FilesContext = createContext<FilesValue>({
  notes: [],
  loading: true,
  folders: [],
  emptyFolders: [],
  addEmptyFolder: () => {},
  moveEmptyFolders: () => {},
  removeEmptyFolders: () => {},
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

  const empty = useEmptyFolders(
    workspaceId,
    useMemo(() => notes.map((note) => note.path), [notes]),
  );

  const value = useMemo<FilesValue>(
    () => ({
      notes,
      loading,
      folders: folderPaths(notes.map((note) => note.path)),
      emptyFolders: empty.emptyFolders,
      addEmptyFolder: empty.addEmptyFolder,
      moveEmptyFolders: empty.moveEmptyFolders,
      removeEmptyFolders: empty.removeEmptyFolders,
      reload,
    }),
    [notes, loading, empty, reload],
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

const emptyFoldersKey = 'notesapp.empty-folders:';

/** Reads the remembered empty folders, without trusting the stored shape. */
function readEmptyFolders(workspaceId: string): readonly string[] {
  try {
    const stored = window.localStorage.getItem(
      `${emptyFoldersKey}${workspaceId}`,
    );
    if (stored === null) return [];
    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => typeof entry === 'string');
  } catch {
    return [];
  }
}

/**
 * Keeps the folders that hold no note across refreshes and reloads.
 *
 * The set lives next to the open folders of the tree, because both are
 * choices of this person on this device. A folder leaves the set as soon as
 * a note lives in it: the note paths then describe the folder and the server
 * carries it to every other device.
 */
function useEmptyFolders(
  workspaceId: string,
  notePaths: readonly string[],
): {
  readonly emptyFolders: readonly string[];
  readonly addEmptyFolder: (folder: string) => void;
  readonly moveEmptyFolders: (fromFolder: string, toFolder: string) => void;
  readonly removeEmptyFolders: (folder: string) => void;
} {
  const [remembered, setRemembered] = useState<readonly string[]>(() =>
    readEmptyFolders(workspaceId),
  );

  useEffect(() => {
    setRemembered(readEmptyFolders(workspaceId));
  }, [workspaceId]);

  /** Stores the set so a reload keeps the shape of the tree. */
  const remember = useCallback(
    (next: readonly string[]): void => {
      try {
        window.localStorage.setItem(
          `${emptyFoldersKey}${workspaceId}`,
          JSON.stringify(next),
        );
      } catch {
        // The tree still works when browser preference storage fails.
      }
    },
    [workspaceId],
  );

  const emptyFolders = useMemo(
    () => pruneEmptyFolders(remembered, notePaths),
    [remembered, notePaths],
  );

  useEffect(() => {
    if (emptyFolders.length === remembered.length) return;
    setRemembered(emptyFolders);
    remember(emptyFolders);
  }, [emptyFolders, remembered, remember]);

  const addEmptyFolder = useCallback(
    (folder: string): void => {
      setRemembered((current) => {
        const next = withEmptyFolder(current, folder);
        remember(next);
        return next;
      });
    },
    [remember],
  );

  const moveEmptyFolders = useCallback(
    (fromFolder: string, toFolder: string): void => {
      setRemembered((current) => {
        const next = rewriteEmptyFolders(current, fromFolder, toFolder);
        remember(next);
        return next;
      });
    },
    [remember],
  );

  const removeEmptyFolders = useCallback(
    (folder: string): void => {
      setRemembered((current) => {
        const next = removeEmptyFoldersPure(current, folder);
        remember(next);
        return next;
      });
    },
    [remember],
  );

  return {
    emptyFolders,
    addEmptyFolder,
    moveEmptyFolders,
    removeEmptyFolders,
  };
}
