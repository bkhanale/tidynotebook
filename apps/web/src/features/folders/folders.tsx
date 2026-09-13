/**
 * The folder dialogs: new folder, move to folder, and rename folder.
 *
 * Every dialog states the outcome before it writes and reports one cause
 * when it cannot run. The rewrite itself lives in `folder-moves.ts`.
 *
 * A folder holds no state of its own: it exists because notes carry a path
 * with a separator in it. New folder therefore writes nothing. It names a
 * folder that this device remembers until a note is made or moved into it,
 * so making a folder never makes a note.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { generateUUID } from '@notesapp/core';
import {
  isLocalStorageError,
  type Draft,
  type LocalStore,
} from '@notesapp/sync';
import { Button, Dialog, DialogBody, DialogFooter } from '@notesapp/ui';
import {
  folderMoves,
  moveProblem,
  type PathMove,
} from '../../lib/folder-moves.ts';
import type { NoteSummary } from '../../lib/note-list.ts';
import { childFolderPath } from '../../lib/folder-selection.ts';
import {
  baseNameOf,
  cleanNoteBaseName,
  cleanNoteName,
  displayNoteName,
  folderOf,
  joinNotePath,
  noteNameProblem,
  noteBaseNameProblem,
  rewriteFolder,
} from '../../lib/note-name.ts';

/**
 * Writes one path rewrite per note as a version.
 *
 * Each note keeps its text and gets a new path, exactly as a rename in the
 * note name field does. A failure stops the run and reports the note that
 * did not move.
 */
export async function applyMoves(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  moves: readonly PathMove[],
): Promise<string | null> {
  for (const move of moves) {
    const cached = await store.readCachedNote(
      accountId,
      workspaceId,
      move.fileId,
    );
    if (cached === null || cached.deleted) continue;
    const draft: Draft = {
      accountId,
      workspaceId,
      workingCopyId: cached.workingCopyId ?? generateUUID(),
      fileId: move.fileId,
      baseRevisionId: cached.baseRevisionId,
      text: cached.text,
      path: move.toPath,
      deleted: false,
      sequence: cached.sequence + 1,
    };
    try {
      await store.saveDraft(draft);
      await store.checkpoint(draft, null);
    } catch (failure: unknown) {
      return isLocalStorageError(failure)
        ? `${displayNoteName(cached.path)} did not move. Free device space and try again.`
        : `${displayNoteName(cached.path)} did not move. Try again.`;
    }
  }
  return null;
}

/** A labelled field with its own error line, shared by the dialogs below. */
function NameField({
  id,
  label,
  help,
  value,
  error,
  onChange,
  onEnter,
}: {
  readonly id: string;
  readonly label: string;
  readonly help?: string | undefined;
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
  readonly onEnter?: (() => void) | undefined;
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
        className="min-h-11 w-full rounded-lg border border-edge bg-app px-3 py-2 text-ui text-strong outline-none motion-safe:transition-shadow focus:border-focus focus:ring-2 focus:ring-focus/25 md:min-h-9"
        type="text"
        value={value}
        autoComplete="off"
        aria-invalid={error !== null}
        aria-describedby={error === null ? `${id}-help` : `${id}-error`}
        onChange={(event): void => onChange(event.target.value)}
        onKeyDown={(event): void => {
          if (event.key !== 'Enter' || onEnter === undefined) return;
          event.preventDefault();
          onEnter();
        }}
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

/**
 * Names a folder. It writes nothing and it creates no note.
 *
 * The folder appears in the tree at once and stays there until a note is
 * made or moved into it. The context menu of the folder row holds New note
 * in this folder.
 */
export function NewFolderDialog({
  open,
  onClose,
  folders,
  parent,
  onCreated,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Every folder that already exists, so a repeated name is refused. */
  readonly folders: readonly string[];
  /** The selected folder, or an empty string for the root. */
  readonly parent: string;
  readonly onCreated: (folder: string) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef('');

  useEffect(() => {
    if (!open) return;
    nameRef.current = '';
    setName('');
    setError(null);
  }, [open]);

  const create = (): void => {
    const child = cleanNoteBaseName(nameRef.current);
    if (child.includes('/')) {
      setError('A folder name cannot contain a slash.');
      return;
    }
    const problem = noteBaseNameProblem(child);
    if (problem !== null) {
      setError(problem.replaceAll('note name', 'folder name'));
      return;
    }
    const folder = childFolderPath(parent, child);
    const pathProblem = noteNameProblem(folder);
    if (pathProblem !== null) {
      setError(pathProblem.replaceAll('note name', 'folder name'));
      return;
    }
    if (folders.some((one) => one.toLowerCase() === folder.toLowerCase())) {
      setError(`A folder named ${folder} already exists.`);
      return;
    }
    onClose();
    onCreated(folder);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New folder"
      titleId="new-folder-title"
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
            id="new-folder-name"
            label="Folder name"
            help="The folder starts empty. Use New note in this folder to fill it."
            value={name}
            error={error}
            onEnter={create}
            onChange={(value) => {
              nameRef.current = value;
              setName(value);
              setError(null);
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Make folder
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** Moves one note into a folder that already exists, or into a new one. */
export function MoveNoteDialog({
  open,
  onClose,
  store,
  accountId,
  workspaceId,
  notes,
  folders,
  fileId,
  path,
  onMoved,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly store: LocalStore | null;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly notes: readonly NoteSummary[];
  readonly folders: readonly string[];
  readonly fileId: string;
  readonly path: string;
  readonly onMoved: (toPath: string) => void;
}): ReactNode {
  const [target, setTarget] = useState<string | null>('');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTarget(folderOf(path));
    setCustom('');
    setError(null);
  }, [open, path]);

  const move = (): void => {
    if (store === null) {
      setError('Local storage is unavailable, so the note cannot move.');
      return;
    }
    const folder = target === null ? cleanNoteName(custom) : target;
    if (target === null && folder === '') {
      setError('Type a folder name.');
      return;
    }
    const toPath = joinNotePath(folder, baseNameOf(path));
    if (toPath === path) {
      onClose();
      return;
    }
    const moves: readonly PathMove[] = [{ fileId, toPath }];
    const problem = moveProblem(moves, notes);
    if (problem !== null) {
      setError(problem);
      return;
    }
    void (async (): Promise<void> => {
      const failure = await applyMoves(store, accountId, workspaceId, moves);
      if (failure !== null) {
        setError(failure);
        return;
      }
      onClose();
      onMoved(toPath);
    })();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Move to folder"
      titleId="move-note-title"
      width="small"
    >
      <DialogBody>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-control font-semibold text-strong">
            Move {displayNoteName(baseNameOf(path))} to
          </legend>
          <ul className="m-0 max-h-64 list-none overflow-y-auto p-0">
            {['', ...folders].map((folder) => (
              <li key={folder === '' ? 'root' : folder}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-ui text-ink hover:bg-hover">
                  <input
                    type="radio"
                    name="move-target"
                    className="size-4 accent-accent-fill"
                    checked={target === folder}
                    onChange={() => {
                      setTarget(folder);
                      setError(null);
                    }}
                  />
                  <span>
                    {folder === '' ? 'All notes, at the top' : folder}
                  </span>
                </label>
              </li>
            ))}
            <li>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-ui text-ink hover:bg-hover">
                <input
                  type="radio"
                  name="move-target"
                  className="size-4 accent-accent-fill"
                  checked={target === null}
                  onChange={() => {
                    setTarget(null);
                    setError(null);
                  }}
                />
                <span>A new folder</span>
              </label>
            </li>
          </ul>
        </fieldset>
        {target === null ? (
          <div className="mt-3">
            <NameField
              id="move-note-folder"
              label="New folder name"
              value={custom}
              error={null}
              onChange={(value) => {
                setCustom(value);
                setError(null);
              }}
            />
          </div>
        ) : null}
        {error === null ? null : (
          <p className="mb-0 mt-3 text-control text-danger" role="alert">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={move}>
          Move note
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * Renames one folder by rewriting the path of every note inside it.
 *
 * A folder that holds no note yet is renamed as well. Nothing is written for
 * it, because only this device remembers it; the caller moves the remembered
 * name with the same call.
 */
export function RenameFolderDialog({
  open,
  onClose,
  store,
  accountId,
  workspaceId,
  notes,
  folders,
  folder,
  onRenamed,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly store: LocalStore | null;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly notes: readonly NoteSummary[];
  /** Every folder that already exists, so a repeated name is refused. */
  readonly folders: readonly string[];
  readonly folder: string;
  readonly onRenamed: (toFolder: string) => void;
}): ReactNode {
  const [name, setName] = useState(folder);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(folder);
    setError(null);
    setBusy(false);
  }, [open, folder]);

  const rename = (): void => {
    if (store === null) {
      setError('Local storage is unavailable, so the folder cannot change.');
      return;
    }
    const toFolder = cleanNoteName(name);
    if (toFolder === folder) {
      onClose();
      return;
    }
    if (toFolder === '') {
      setError('Type a folder name.');
      return;
    }
    const named = noteNameProblem(toFolder);
    if (named !== null) {
      setError(named);
      return;
    }
    if (
      folders.some(
        (one) =>
          one.toLowerCase() === toFolder.toLowerCase() &&
          one.toLowerCase() !== folder.toLowerCase(),
      )
    ) {
      setError(`A folder named ${toFolder} already exists.`);
      return;
    }
    const moves = folderMoves(notes, folder, toFolder);
    // A folder with no note in it moves no note. Only the remembered name
    // changes, and the caller owns that.
    if (moves.length === 0) {
      onClose();
      onRenamed(toFolder);
      return;
    }
    const problem = moveProblem(moves, notes);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    void (async (): Promise<void> => {
      const failure = await applyMoves(store, accountId, workspaceId, moves);
      setBusy(false);
      if (failure !== null) {
        setError(failure);
        return;
      }
      onClose();
      onRenamed(toFolder);
    })();
  };

  const count = notes.filter(
    (note) => rewriteFolder(note.path, folder, folder) !== null,
  ).length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rename folder"
      titleId="rename-folder-title"
      width="small"
    >
      <DialogBody>
        <NameField
          id="rename-folder-name"
          label="Folder name"
          help={
            count === 0
              ? 'This folder holds no note yet.'
              : `This changes the name of ${String(count)} ${count === 1 ? 'note' : 'notes'}.`
          }
          value={name}
          error={error}
          onChange={(value) => {
            setName(value);
            setError(null);
          }}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={rename}>
          Rename folder
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
