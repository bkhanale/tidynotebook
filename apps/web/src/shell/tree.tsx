/**
 * The tree of the sidebar: one list of rows with a selection (record 0164).
 *
 * `lib/tree-rows.ts` turns the folders and the notes into the rows a person
 * can see, and this module renders them as the tree of WAI-ARIA: one `tree`
 * with a `treeitem` for each row that states its level, its place, whether it
 * is open and whether it is selected. One row is in the tab order, and the
 * keys of `lib/tree-keys.ts` move the focus, open and close a folder, build a
 * selection, rename a row in place, open the menu and move the selection to
 * Trash. A long tree renders a window of its rows (record 0165).
 *
 * The action button of a row, a right click, Shift + F10 and the Menu key
 * open one menu, whose rows `lib/tree-actions.ts` decides. Each action is an
 * operation that exists: a move and a rename are one `moveFiles` of the local
 * store and a move to Trash is one `trashFiles` (record 0032). The dialogs of
 * a move and of a publish sit in the frame, because the sidebar is a box that
 * slides and a dialog inside it would take its width, so this module asks the
 * frame to open them.
 *
 * A row is a drag source and a folder row is a drop target. A row of a
 * selection drags the whole selection. The rules of a drop live in
 * `lib/folder-moves.ts` and the state of the gesture in `tree-drag.ts`.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router';
import type { PublicationScope } from '@notesapp/core';
import {
  AnchoredMenu,
  Badge,
  buttonClassName,
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  inlineFieldClassName,
  MoreIcon,
  rowClassName,
  type MenuAnchor,
  type MenuItem,
} from '@notesapp/ui';
import { useLocalStore, useRequestSync, useSession } from '../app.tsx';
import { useDeleteNotice } from '../features/trash/trash.tsx';
import { deleteNotes } from '../features/editor/note-delete.ts';
import { applyMoves } from '../features/folders/apply-moves.ts';
import {
  downloadNote,
  transferFailureMessage,
} from '../features/export/export.ts';
import { duplicateNote } from '../features/notes/duplicate-note.ts';
import { actionIcon } from './action-icons.tsx';
import { useFiles, type OpenFoldersControl } from './files.tsx';
import { useRowWindow } from './row-window.ts';
import type { TreeDrag } from './tree-drag.ts';
import type { DragItem } from '../lib/folder-moves.ts';
import type { TreeNode } from '../lib/note-list.ts';
import { baseNameOf, displayNoteName } from '../lib/note-name.ts';
import { copyNoteLink, noteAddress } from '../lib/copy-link.ts';
import { copyText } from '../platform.ts';
import {
  treeMenu,
  type TreeAction,
  type TreeTarget,
} from '../lib/tree-actions.ts';
import { treeKeyIntent } from '../lib/tree-keys.ts';
import {
  renamePlan,
  renameStartName,
  type RenameTarget,
} from '../lib/tree-rename.ts';
import {
  treeIndentClassName,
  treeItemsClassName,
  treeRowClassName,
  treeRowLeadingClassName,
  treeRowNameClassName,
} from '../lib/tree-row.ts';
import {
  actionableKeys,
  folderRowKey,
  isActionable,
  noteRowKey,
  visibleTreeRows,
  type ActionableRow,
} from '../lib/tree-rows.ts';
import {
  actionTargets,
  emptySelection,
  isRowSelected,
  keepVisible,
  selectAll,
  selectRange,
  toggleRow,
  type TreeSelection,
} from '../lib/tree-selection.ts';
import { trashPlan } from '../lib/tree-trash.ts';

/**
 * One icon action that sits on a row: the chevron and the row menu.
 *
 * A ghost control of the one recipe, square, and as small as a row allows on
 * a desktop while it keeps the 44 px touch target under the medium width.
 */
export const rowActionClassName = buttonClassName({
  variant: 'ghost',
  size: 'sm',
  className: 'size-11 shrink-0 px-0 md:size-7',
});

/** The column that a row with no chevron keeps for one, so names line up. */
export const rowSpacerClassName = 'size-11 shrink-0 md:size-7';

/** What the tree asks the frame to do, and what it reads from it. */
export type NoteTreeProps = {
  readonly workspaceId: string;
  /** The folders and the notes of the tree, from `buildNoteTree`. */
  readonly nodes: readonly TreeNode[];
  /** Every folder the tree can show, which a rename must not take. */
  readonly knownFolders: readonly string[];
  readonly activeFileId: string | null;
  /** The folder that a create action uses as its parent (record 0029). */
  readonly selectedFolder: string;
  readonly folders: OpenFoldersControl;
  readonly drag: TreeDrag;
  /** Makes a folder the create parent and opens it. */
  readonly onSelectFolder: (folder: string) => void;
  /** Runs after a row opens a screen, which closes the drawer on a phone. */
  readonly onNavigate: () => void;
  readonly onNewNoteIn: (folder: string) => void;
  readonly onNewFolderIn: (folder: string) => void;
  /** Opens the Publish dialog of the frame for one note or one folder. */
  readonly onPublish: (scope: PublicationScope) => void;
  /** Opens the Move to folder dialog of the frame for some rows. */
  readonly onMove: (items: readonly DragItem[]) => void;
};

/** The row that a rename in place edits, and the words in its field. */
type Renaming = {
  readonly key: string;
  readonly target: RenameTarget;
  readonly value: string;
};

/** The one line under the tree: a result or the reason an action stopped. */
type TreeMessage = {
  readonly tone: 'status' | 'problem';
  readonly text: string;
};

/** The menu that is open, the place it opens at and the rows it acts on. */
type OpenMenu = {
  readonly anchor: MenuAnchor;
  readonly keys: readonly string[];
  /** The row that takes the focus back when a key closes the menu. */
  readonly returnKey: string;
};

/** The target of an action that one row starts. */
function targetOf(row: ActionableRow): TreeTarget {
  return row.kind === 'note'
    ? { kind: 'note', fileId: row.note.fileId, path: row.note.path }
    : { kind: 'folder', path: row.path };
}

/** What a drag or a move of one target carries. */
function dragItemOf(target: TreeTarget): DragItem {
  return target.kind === 'note'
    ? { kind: 'note', fileId: target.fileId, path: target.path }
    : { kind: 'folder', folder: target.path };
}

/** The place on the screen of one element, for a menu that opens beside it. */
function anchorOf(element: Element): MenuAnchor {
  const box = element.getBoundingClientRect();
  return {
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
  };
}

/** The tree of the folders and the notes of the open workspace. */
export function NoteTree({
  workspaceId,
  nodes,
  knownFolders,
  activeFileId,
  selectedFolder,
  folders,
  drag,
  onSelectFolder,
  onNavigate,
  onNewNoteIn,
  onNewFolderIn,
  onPublish,
  onMove,
}: NoteTreeProps): ReactNode {
  const navigate = useNavigate();
  const files = useFiles();
  const store = useLocalStore();
  const session = useSession();
  const accountId = session.account?.accountId ?? null;
  const requestSync = useRequestSync();
  const { announce } = useDeleteNotice();
  const { openFolders, toggleFolder, openFolder } = folders;

  const rows = useMemo(
    () => visibleTreeRows(nodes, openFolders),
    [nodes, openFolders],
  );
  const order = useMemo(() => actionableKeys(rows), [rows]);
  const rowByKey = useMemo(
    () =>
      new Map(
        rows.flatMap((row) =>
          isActionable(row) ? [[row.key, row] as const] : [],
        ),
      ),
    [rows],
  );
  const indexByKey = useMemo(
    () => new Map(rows.map((row, index) => [row.key, index] as const)),
    [rows],
  );
  const activeKey = activeFileId === null ? null : noteRowKey(activeFileId);

  const [selection, setSelection] = useState<TreeSelection>(emptySelection);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [message, setMessage] = useState<TreeMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const elements = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const revealedFor = useRef<string | null>(null);
  const rowsInView = useRowWindow(rows.length);
  const selecting = selection.keys.size > 0;

  // A row that left the screen leaves the selection.
  useEffect(() => {
    setSelection((current) => keepVisible(current, order));
  }, [order]);

  // A result stands for a few seconds. A problem stands until the next act.
  useEffect(() => {
    if (message?.tone !== 'status') return;
    const timer = globalThis.setTimeout(() => setMessage(null), 4000);
    return () => globalThis.clearTimeout(timer);
  }, [message]);

  // The open note comes into view when it changes, so a note opened from the
  // palette or a link is visible in the tree even when it was below the
  // fold. Its row may not be in the window yet, so the box scrolls to it.
  const activeIndex =
    activeKey === null ? -1 : (indexByKey.get(activeKey) ?? -1);
  useEffect(() => {
    if (activeKey === null || activeIndex === -1) return;
    if (revealedFor.current === activeKey) return;
    revealedFor.current = activeKey;
    rowsInView.reveal(activeIndex);
  }, [activeKey, activeIndex, rowsInView]);

  // A row that took the focus while it was outside the window takes it once
  // the window renders it.
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    const element = elements.current.get(key);
    if (element === undefined) return;
    pendingFocus.current = null;
    element.focus();
  });

  /** Moves the focus to one row, and brings it into the window first. */
  const focusRow = useCallback(
    (key: string): void => {
      setFocusKey(key);
      const element = elements.current.get(key);
      if (element !== undefined) {
        element.focus();
        return;
      }
      const index = indexByKey.get(key);
      if (index === undefined) return;
      pendingFocus.current = key;
      rowsInView.reveal(index);
    },
    [indexByKey, rowsInView],
  );

  /** The rows an action started from one row acts on. */
  const targetsFor = useCallback(
    (key: string): readonly string[] => actionTargets(selection, order, key),
    [selection, order],
  );

  /** The targets of some keys, in the order of the screen. */
  const targetsOfKeys = useCallback(
    (keys: readonly string[]): readonly TreeTarget[] =>
      keys.flatMap((key) => {
        const row = rowByKey.get(key);
        return row === undefined ? [] : [targetOf(row)];
      }),
    [rowByKey],
  );

  /** Moves the notes of some rows to Trash, as one store operation. */
  const trash = useCallback(
    (keys: readonly string[]): void => {
      if (busy) return;
      const plan = trashPlan(targetsOfKeys(keys), files.notes);
      setMessage(null);
      if (plan.items.length === 0) {
        for (const folder of plan.dropFolders) files.removeEmptyFolders(folder);
        setSelection(emptySelection);
        return;
      }
      const activeStore = store.store;
      if (activeStore === null || accountId === null) {
        setMessage({
          tone: 'problem',
          text: 'Local storage is unavailable, so nothing moved to Trash.',
        });
        return;
      }
      // The folder of a note that leaves stays on this device, so the tree
      // still shows it. Remember it before the tombstone publishes its change.
      for (const folder of plan.keepFolders) files.addEmptyFolder(folder);
      const holdsOpenNote =
        activeFileId !== null &&
        plan.items.some((item) => item.fileId === activeFileId);
      setBusy(true);
      void (async (): Promise<void> => {
        const outcome = await deleteNotes(
          activeStore,
          accountId,
          workspaceId,
          plan.items,
        );
        setBusy(false);
        if (!outcome.ok) {
          setMessage({ tone: 'problem', text: outcome.message });
          return;
        }
        announce({ workspaceId, items: plan.items });
        requestSync();
        for (const folder of plan.dropFolders) files.removeEmptyFolders(folder);
        setSelection(emptySelection);
        if (holdsOpenNote) void navigate(`/w/${workspaceId}`);
      })();
    },
    [
      busy,
      targetsOfKeys,
      files,
      store.store,
      accountId,
      activeFileId,
      workspaceId,
      announce,
      requestSync,
      navigate,
    ],
  );

  /** Turns the name of one row into a field. */
  const startRename = useCallback(
    (key: string): void => {
      const row = rowByKey.get(key);
      if (row === undefined) return;
      const target: RenameTarget =
        row.kind === 'note'
          ? { kind: 'note', fileId: row.note.fileId, path: row.note.path }
          : { kind: 'folder', path: row.path };
      setMessage(null);
      setFocusKey(key);
      setRenaming({ key, target, value: renameStartName(target) });
    },
    [rowByKey],
  );

  /** Gives the row its name back and the focus to the row. */
  const cancelRename = useCallback((): void => {
    const key = renaming?.key ?? null;
    setRenaming(null);
    setMessage(null);
    if (key !== null) focusRow(key);
  }, [renaming, focusRow]);

  /** Keeps the typed name, or states why it cannot be kept. */
  const commitRename = useCallback((): void => {
    if (renaming === null || busy) return;
    const plan = renamePlan(
      renaming.target,
      renaming.value,
      files.notes,
      knownFolders,
    );
    if (plan.kind === 'refused') {
      setMessage({ tone: 'problem', text: plan.problem });
      return;
    }
    if (plan.kind === 'unchanged') {
      cancelRename();
      return;
    }
    const activeStore = store.store;
    if (plan.moves.length > 0 && (activeStore === null || accountId === null)) {
      setMessage({
        tone: 'problem',
        text: 'Local storage is unavailable, so the name did not change.',
      });
      return;
    }
    const done = (): void => {
      const moved = plan.folder;
      if (moved !== null) {
        files.moveEmptyFolders(moved.from, moved.to);
        if (openFolders.has(moved.from)) openFolder(moved.to);
        if (selectedFolder === moved.from) onSelectFolder(moved.to);
      }
      setRenaming(null);
      setMessage(null);
      focusRow(moved === null ? renaming.key : folderRowKey(moved.to));
    };
    if (plan.moves.length === 0 || activeStore === null || accountId === null) {
      done();
      return;
    }
    setBusy(true);
    void (async (): Promise<void> => {
      const failure = await applyMoves(
        activeStore,
        accountId,
        workspaceId,
        plan.moves,
      );
      setBusy(false);
      if (failure !== null) {
        setMessage({ tone: 'problem', text: failure });
        return;
      }
      done();
    })();
  }, [
    renaming,
    busy,
    files,
    knownFolders,
    cancelRename,
    store.store,
    accountId,
    openFolders,
    openFolder,
    selectedFolder,
    onSelectFolder,
    focusRow,
    workspaceId,
  ]);

  /** Copies one note into a new note beside it and opens the copy. */
  const duplicate = useCallback(
    (target: TreeTarget): void => {
      if (target.kind !== 'note') return;
      const activeStore = store.store;
      if (activeStore === null || accountId === null) {
        setMessage({
          tone: 'problem',
          text: 'Local storage is unavailable, so the note was not copied.',
        });
        return;
      }
      void (async (): Promise<void> => {
        const name = displayNoteName(baseNameOf(target.path));
        const cached = await activeStore
          .readCachedNote(accountId, workspaceId, target.fileId)
          .catch(() => null);
        if (cached === null) {
          setMessage({
            tone: 'problem',
            text: `${name} is not on this device yet. Try again in a moment.`,
          });
          return;
        }
        let fileId: string;
        try {
          fileId = await duplicateNote(activeStore, {
            accountId,
            workspaceId,
            path: target.path,
            text: cached.text,
            takenPaths: files.notes.map((note) => note.path),
          });
        } catch {
          setMessage({
            tone: 'problem',
            text: `${name} was not copied on this device. Try again.`,
          });
          return;
        }
        setSelection(emptySelection);
        onNavigate();
        void navigate(`/w/${workspaceId}/notes/${fileId}`);
      })();
    },
    [store.store, accountId, workspaceId, files.notes, onNavigate, navigate],
  );

  /** Runs one row of a tree menu on the rows it acts on. */
  const run = useCallback(
    (action: TreeAction, keys: readonly string[]): void => {
      const targets = targetsOfKeys(keys);
      const first = targets[0];
      if (first === undefined) return;
      switch (action) {
        case 'open':
        case 'history':
          if (first.kind !== 'note') return;
          setSelection(emptySelection);
          onNavigate();
          void navigate(
            action === 'open'
              ? `/w/${workspaceId}/notes/${first.fileId}`
              : `/w/${workspaceId}/notes/${first.fileId}/history`,
          );
          return;
        case 'publish':
          onPublish(
            first.kind === 'note'
              ? { kind: 'note', fileId: first.fileId }
              : { kind: 'folder', path: first.path },
          );
          return;
        case 'rename': {
          const key = keys[0];
          if (key !== undefined) startRename(key);
          return;
        }
        case 'move':
          onMove(targets.map(dragItemOf));
          return;
        case 'duplicate':
          duplicate(first);
          return;
        case 'copy-link':
          if (first.kind !== 'note') return;
          void copyNoteLink(
            noteAddress(globalThis.location.origin, workspaceId, first.fileId),
            copyText,
          ).then((text) => setMessage({ tone: 'status', text }));
          return;
        case 'export':
          if (first.kind !== 'note') return;
          void downloadNote(workspaceId, first.fileId).catch(
            (failure: unknown) => {
              setMessage({
                tone: 'problem',
                text: transferFailureMessage(failure),
              });
            },
          );
          return;
        case 'new-note':
          if (first.kind === 'folder') onNewNoteIn(first.path);
          return;
        case 'new-folder':
          if (first.kind === 'folder') onNewFolderIn(first.path);
          return;
        case 'move-to-trash':
          trash(keys);
          return;
        case 'attach-image':
          return;
      }
    },
    [
      targetsOfKeys,
      onNavigate,
      navigate,
      workspaceId,
      onPublish,
      startRename,
      onMove,
      duplicate,
      onNewNoteIn,
      onNewFolderIn,
      trash,
    ],
  );

  /** Opens the menu of one row at a place on the screen. */
  const openMenu = useCallback(
    (key: string, anchor: MenuAnchor): void => {
      // A row outside the selection acts for itself alone, and the selection
      // gives way to it, as a file manager does on a right click.
      if (!isRowSelected(selection, key)) setSelection(emptySelection);
      setFocusKey(key);
      setMenu({ anchor, keys: targetsFor(key), returnKey: key });
    },
    [selection, targetsFor],
  );

  /** A click on a row with Ctrl, Cmd or Shift builds the selection. */
  const pickWith = useCallback(
    (event: ReactMouseEvent, key: string): boolean => {
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        const current =
          activeKey !== null && order.includes(activeKey) && !selecting
            ? activeKey
            : null;
        setSelection((now) => toggleRow(now, key, current));
        setFocusKey(key);
        return true;
      }
      if (event.shiftKey) {
        event.preventDefault();
        const from =
          focusKey ??
          (activeKey !== null && order.includes(activeKey) ? activeKey : null);
        setSelection((now) => selectRange(now, order, key, from));
        setFocusKey(key);
        return true;
      }
      return false;
    },
    [activeKey, order, selecting, focusKey],
  );

  /** The keys of the tree, from the row that has the focus. */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (renaming !== null) return;
    const intent = treeKeyIntent(event);
    if (intent === null) return;
    const key =
      focusKey !== null && order.includes(focusKey) ? focusKey : order[0];
    if (key === undefined) return;
    const at = order.indexOf(key);
    const row = rowByKey.get(key);
    const step = (delta: number): string | undefined =>
      order[Math.min(Math.max(at + delta, 0), order.length - 1)];
    if (intent === 'clear') {
      // Escape with nothing to clear belongs to the drawer around the tree.
      if (!selecting) return;
      event.preventDefault();
      event.stopPropagation();
      setSelection(emptySelection);
      return;
    }
    event.preventDefault();
    switch (intent) {
      case 'next':
      case 'previous': {
        const next = step(intent === 'next' ? 1 : -1);
        if (next !== undefined) focusRow(next);
        return;
      }
      case 'extend-next':
      case 'extend-previous': {
        const next = step(intent === 'extend-next' ? 1 : -1);
        if (next === undefined) return;
        setSelection((now) => selectRange(now, order, next, key));
        focusRow(next);
        return;
      }
      case 'first':
      case 'last': {
        const next = intent === 'first' ? order[0] : order.at(-1);
        if (next !== undefined) focusRow(next);
        return;
      }
      case 'expand':
        if (row?.kind !== 'folder') return;
        if (!row.expanded) toggleFolder(row.path);
        else {
          const child = rows[(indexByKey.get(key) ?? -1) + 1];
          if (
            child !== undefined &&
            isActionable(child) &&
            child.parentKey === key
          )
            focusRow(child.key);
        }
        return;
      case 'collapse':
        if (row?.kind === 'folder' && row.expanded) {
          toggleFolder(row.path);
          return;
        }
        if (row !== undefined && row.parentKey !== null)
          focusRow(row.parentKey);
        return;
      case 'activate':
        setSelection(emptySelection);
        if (row?.kind === 'note') {
          onNavigate();
          void navigate(`/w/${workspaceId}/notes/${row.note.fileId}`);
        } else if (row?.kind === 'folder') onSelectFolder(row.path);
        return;
      case 'toggle-select':
        setSelection((now) => toggleRow(now, key));
        return;
      case 'select-all':
        setSelection(selectAll(order));
        return;
      case 'rename':
        startRename(key);
        return;
      case 'menu': {
        const element = elements.current.get(key);
        if (element !== undefined) openMenu(key, anchorOf(element));
        return;
      }
      case 'trash':
        trash(targetsFor(key));
        return;
    }
  };

  // The one row in the tab order: the row with the focus, else the open note,
  // else the first row of the window, so Tab always reaches the tree.
  const rendered = rows.slice(rowsInView.start, rowsInView.end);
  const renderedKeys = rendered.filter(isActionable).map((row) => row.key);
  const tabbable =
    focusKey !== null && renderedKeys.includes(focusKey)
      ? focusKey
      : activeKey !== null && renderedKeys.includes(activeKey)
        ? activeKey
        : (renderedKeys[0] ?? null);

  const openTargets = menu === null ? [] : targetsOfKeys(menu.keys);
  const openTree = menu === null ? null : treeMenu(openTargets);

  return (
    <>
      <div
        ref={rowsInView.listRef}
        className={treeItemsClassName}
        role="tree"
        aria-label="Folders"
        aria-multiselectable="true"
        onKeyDown={onKeyDown}
      >
        {rendered.map((row) =>
          row.kind === 'empty' ? (
            <div
              key={row.key}
              role="none"
              className={treeIndentClassName(row.level)}
            >
              <div className={rowClassName({ interactive: false })}>
                <span className={rowSpacerClassName} aria-hidden="true" />
                <span className="min-w-0 truncate text-muted">
                  This folder is empty.
                </span>
              </div>
            </div>
          ) : (
            <TreeRow
              key={row.key}
              row={row}
              workspaceId={workspaceId}
              open={row.key === activeKey}
              parent={row.kind === 'folder' && row.path === selectedFolder}
              picked={isRowSelected(selection, row.key)}
              selecting={selecting}
              tabbable={row.key === tabbable}
              renaming={renaming?.key === row.key ? renaming : null}
              drag={drag}
              register={(element) => {
                if (element === null) elements.current.delete(row.key);
                else elements.current.set(row.key, element);
              }}
              onFocus={() => setFocusKey(row.key)}
              onPick={(event) => pickWith(event, row.key)}
              onPlainClick={() => {
                setSelection(emptySelection);
                setFocusKey(row.key);
                if (row.kind === 'note') onNavigate();
                else onSelectFolder(row.path);
              }}
              onToggle={() => {
                if (row.kind === 'folder') toggleFolder(row.path);
              }}
              onDragItems={() =>
                targetsOfKeys(targetsFor(row.key)).map(dragItemOf)
              }
              onMenu={(anchor) => openMenu(row.key, anchor)}
              onRenameChange={(value) => {
                setRenaming((now) => (now === null ? now : { ...now, value }));
                setMessage(null);
              }}
              onRenameCommit={commitRename}
              onRenameCancel={cancelRename}
            />
          ),
        )}
      </div>
      {message === null ? null : (
        <p
          className={`mx-2 my-2 text-control ${message.tone === 'problem' ? 'text-danger' : 'text-muted'}`}
          role={message.tone === 'problem' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
      {menu === null || openTree === null ? null : (
        <AnchoredMenu
          label={openTree.label}
          anchor={menu.anchor}
          align="start"
          items={openTree.rows.map((row): MenuItem => ({
            id: row.id,
            label: row.label,
            icon: actionIcon(row.icon),
            onSelect: () => run(row.id, menu.keys),
          }))}
          pinned={openTree.pinned.map((row): MenuItem => ({
            id: row.id,
            label: row.label,
            icon: actionIcon(row.icon),
            danger: true,
            onSelect: () => run(row.id, menu.keys),
          }))}
          onClose={(restoreFocus) => {
            const key = menu.returnKey;
            setMenu(null);
            if (restoreFocus) focusRow(key);
          }}
        />
      )}
    </>
  );
}

/** One row of the tree: a note or a folder, its actions and its marks. */
function TreeRow({
  row,
  workspaceId,
  open,
  parent,
  picked,
  selecting,
  tabbable,
  renaming,
  drag,
  register,
  onFocus,
  onPick,
  onPlainClick,
  onToggle,
  onDragItems,
  onMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: {
  readonly row: ActionableRow;
  readonly workspaceId: string;
  /** The row is the note that the screen shows. */
  readonly open: boolean;
  /** The row is the folder that a create action uses. */
  readonly parent: boolean;
  /** The row is in the selection. */
  readonly picked: boolean;
  /** Some row is in the selection. */
  readonly selecting: boolean;
  /** The row is the one row of the tree in the tab order. */
  readonly tabbable: boolean;
  readonly renaming: Renaming | null;
  readonly drag: TreeDrag;
  readonly register: (element: HTMLElement | null) => void;
  readonly onFocus: () => void;
  /** Builds the selection when a modifier key is down, and says if it did. */
  readonly onPick: (event: ReactMouseEvent) => boolean;
  readonly onPlainClick: () => void;
  readonly onToggle: () => void;
  readonly onDragItems: () => readonly DragItem[];
  readonly onMenu: (anchor: MenuAnchor) => void;
  readonly onRenameChange: (value: string) => void;
  readonly onRenameCommit: () => void;
  readonly onRenameCancel: () => void;
}): ReactNode {
  const isFolder = row.kind === 'folder';
  const isTarget = isFolder && drag.over === row.path;
  const menuLabel = isFolder
    ? `Actions for the folder ${row.name}`
    : `Actions for the note ${row.name}`;
  const treeItem = {
    role: 'treeitem',
    'aria-level': row.level,
    'aria-posinset': row.posInSet,
    'aria-setsize': row.setSize,
    'aria-selected': picked || (!selecting && open),
    'aria-expanded': isFolder ? row.expanded : undefined,
    tabIndex: tabbable ? 0 : -1,
    onFocus,
  } as const;
  const icon = (
    <span className="inline-flex shrink-0 items-center" aria-hidden="true">
      {row.kind === 'note' ? (
        <FileTextIcon />
      ) : row.expanded ? (
        <FolderOpenIcon />
      ) : (
        <FolderIcon />
      )}
    </span>
  );
  const field =
    renaming === null ? null : (
      <input
        className={inlineFieldClassName()}
        value={renaming.value}
        aria-label={isFolder ? 'Name of the folder' : 'Name of the note'}
        autoComplete="off"
        spellCheck={false}
        // The field takes the focus as it opens, as the rename asked for it,
        // with the name selected so typing replaces it.
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onRenameChange(event.target.value)}
        onBlur={onRenameCommit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            onRenameCommit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onRenameCancel();
          }
        }}
      />
    );
  const name = field ?? (
    <span className="min-w-0 flex-1 truncate" title={row.name}>
      {row.name}
    </span>
  );
  const badge =
    row.kind === 'note' && (row.note.localOnly || row.note.unsent) ? (
      <span className="shrink-0" title="On this device only">
        <Badge>Local</Badge>
      </span>
    ) : null;

  return (
    <div role="none" className={treeIndentClassName(row.level)}>
      <div
        role="none"
        className={treeRowClassName({
          open,
          selected: parent,
          picked,
          selecting,
          dropTarget: isTarget,
        })}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu({
            top: event.clientY,
            left: event.clientX,
            width: 0,
            height: 0,
          });
        }}
        onDragOver={(event) => {
          if (!isFolder || !drag.accepts(row.path)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          drag.hover(row.path);
        }}
        onDragLeave={() => {
          if (isTarget) drag.hover(null);
        }}
        onDrop={(event) => {
          if (!isFolder) return;
          event.preventDefault();
          drag.drop(row.path);
        }}
      >
        <div className={treeRowLeadingClassName}>
          {isFolder ? (
            // The chevron is for a pointer. The keyboard opens and closes a
            // folder with Right and Left, so the chevron is not a tab stop.
            <button
              type="button"
              tabIndex={-1}
              className={rowActionClassName}
              onClick={onToggle}
              aria-label={`${row.expanded ? 'Collapse' : 'Expand'} folder ${row.name}`}
              title={`${row.expanded ? 'Collapse' : 'Expand'} folder ${row.name}`}
            >
              <span className="inline-flex text-muted" aria-hidden="true">
                {row.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </span>
            </button>
          ) : (
            <span className={rowSpacerClassName} aria-hidden="true" />
          )}
          {row.kind === 'note' && renaming === null ? (
            <Link
              {...treeItem}
              ref={register}
              className={treeRowNameClassName}
              to={`/w/${workspaceId}/notes/${row.note.fileId}`}
              aria-current={open ? 'page' : undefined}
              draggable
              onClick={(event) => {
                if (onPick(event)) return;
                onPlainClick();
              }}
              onDragStart={(event) => drag.begin(event, onDragItems())}
              onDragEnd={() => drag.end()}
            >
              {icon}
              {name}
              {badge}
            </Link>
          ) : (
            <div
              {...treeItem}
              ref={register}
              className={treeRowNameClassName}
              aria-current={open ? 'page' : undefined}
              draggable={renaming === null}
              onClick={(event) => {
                if (renaming !== null) return;
                if (onPick(event)) return;
                onPlainClick();
              }}
              onDragStart={(event) => drag.begin(event, onDragItems())}
              onDragEnd={() => drag.end()}
            >
              {icon}
              {name}
              {badge}
            </div>
          )}
        </div>
        {/*
          The action button opens the menu that a right click and Shift + F10
          open. The keyboard reaches that menu from the row, so the button is
          not a tab stop, and it keeps its name for a screen reader on a touch
          screen, which has no right click.
        */}
        <button
          type="button"
          tabIndex={-1}
          className={rowActionClassName}
          aria-label={menuLabel}
          aria-haspopup="menu"
          title={menuLabel}
          onClick={(event) => onMenu(anchorOf(event.currentTarget))}
        >
          <span className="inline-flex text-muted" aria-hidden="true">
            <MoreIcon />
          </span>
        </button>
      </div>
    </div>
  );
}
