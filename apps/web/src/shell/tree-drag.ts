/**
 * Dragging a row of the sidebar tree onto a folder.
 *
 * The pointer path and the keyboard path do the same work: a drop runs the
 * rewrite of `folder-moves.ts`, exactly as the Move to dialog and the Rename
 * folder dialog do. Nothing is written unless every new path is free, and a
 * refused drop states one cause.
 *
 * The rules are pure and live in `folder-moves.ts`. This hook holds only the
 * state that a pointer gesture needs, so the row handlers stay thin.
 */
import {
  useCallback,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import type { LocalStore } from '@notesapp/sync';
import { planDrop, type DragItem } from '../lib/folder-moves.ts';
import { applyMoves } from '../features/folders/folders.tsx';
import type { NoteSummary } from '../lib/note-list.ts';

/** The media type of one dragged row. It stays inside this application. */
const dragMediaType = 'application/x-notesapp-tree';

/** What every row of the tree needs to take part in a drag. */
export type TreeDrag = {
  /** The row that is being dragged, or `null` when no drag is running. */
  readonly item: DragItem | null;
  /** The folder under the pointer, where the empty string is the root. */
  readonly over: string | null;
  /** Starts a drag and puts the row on the data transfer. */
  readonly begin: (event: ReactDragEvent, item: DragItem) => void;
  /** Ends a drag, whether it dropped or not. */
  readonly end: () => void;
  /** Marks the folder under the pointer, or clears the mark with `null`. */
  readonly hover: (folder: string | null) => void;
  /** Runs the drop on one folder. The empty string is the root. */
  readonly drop: (folder: string) => void;
  /** Whether a drop on this folder would do something. */
  readonly accepts: (folder: string) => boolean;
  /** The one sentence that states why the last drop was refused. */
  readonly problem: string | null;
  /** Clears that sentence. */
  readonly dismissProblem: () => void;
};

/** Holds the drag state of the tree and performs the drop. */
export function useTreeDrag({
  store,
  accountId,
  workspaceId,
  notes,
  emptyFolders,
  moveEmptyFolders,
  openFolder,
}: {
  readonly store: LocalStore | null;
  readonly accountId: string | null;
  readonly workspaceId: string;
  readonly notes: readonly NoteSummary[];
  readonly emptyFolders: readonly string[];
  readonly moveEmptyFolders: (fromFolder: string, toFolder: string) => void;
  readonly openFolder: (folder: string) => void;
}): TreeDrag {
  const [item, setItem] = useState<DragItem | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The drop reads the row from a ref: `dataTransfer` is not readable while
  // the pointer only moves over a target, so the highlight needs its own copy.
  const dragged = useRef<DragItem | null>(null);

  const begin = useCallback((event: ReactDragEvent, next: DragItem): void => {
    dragged.current = next;
    setItem(next);
    setProblem(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(dragMediaType, JSON.stringify(next));
  }, []);

  const end = useCallback((): void => {
    dragged.current = null;
    setItem(null);
    setOver(null);
  }, []);

  const accepts = useCallback(
    (folder: string): boolean => {
      const current = dragged.current;
      if (current === null) return false;
      const outcome = planDrop(current, folder, notes, emptyFolders);
      return outcome.plan !== null;
    },
    [notes, emptyFolders],
  );

  const drop = useCallback(
    (folder: string): void => {
      const current = dragged.current;
      end();
      if (current === null) return;
      const outcome = planDrop(current, folder, notes, emptyFolders);
      if (outcome.problem !== null) {
        setProblem(outcome.problem);
        return;
      }
      const plan = outcome.plan;
      if (plan === null) return;
      setProblem(null);
      if (plan.folderMove !== null)
        moveEmptyFolders(plan.folderMove.from, plan.folderMove.to);
      if (folder !== '') openFolder(folder);
      if (plan.moves.length === 0) return;
      if (store === null || accountId === null) {
        setProblem('Local storage is unavailable, so nothing moved.');
        return;
      }
      void (async (): Promise<void> => {
        const failure = await applyMoves(
          store,
          accountId,
          workspaceId,
          plan.moves,
        );
        if (failure !== null) setProblem(failure);
      })();
    },
    [
      end,
      notes,
      emptyFolders,
      moveEmptyFolders,
      openFolder,
      store,
      accountId,
      workspaceId,
    ],
  );

  return {
    item,
    over,
    begin,
    end,
    hover: setOver,
    drop,
    accepts,
    problem,
    dismissProblem: useCallback(() => setProblem(null), []),
  };
}
