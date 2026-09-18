/**
 * The folder dialogs: new folder, move to folder, and rename folder.
 *
 * Every dialog states the outcome before it writes and reports one cause
 * when it cannot run. The rules of a rewrite live in `lib/folder-moves.ts`
 * and the write itself lives in `apply-moves.ts`.
 *
 * A folder holds no state of its own: it exists because notes carry a path
 * with a separator in it. New folder therefore writes nothing. It names a
 * folder that this device remembers until a note is made or moved into it,
 * so making a folder never makes a note.
 *
 * Every field here is the one `TextField` of `@notesapp/ui` and every row of
 * the folder picker is the one row recipe, so no dialog of this feature writes
 * the classes of a control (decision 0065). Each dialog is a form, so Enter
 * confirms it the way the platform confirms a form.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LocalStore } from '@notesapp/sync';
import {
  Button,
  CheckIcon,
  Dialog,
  DialogBody,
  DialogFooter,
  Notice,
  rowClassName,
  TextField,
} from '@notesapp/ui';
import { applyMoves } from './apply-moves.ts';
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
 * One row of the folder picker.
 *
 * The radio is the control and the row is what a person sees, so the input is
 * visually hidden inside the label and the row reads the one row recipe with
 * its `selected` mark (decisions 0062 and 0065). A hidden input still takes
 * the focus and the arrow keys of a radio group, so the row states that focus
 * with `focus-within`: `focus-visible` on the label would never match.
 */
function FolderChoice({
  label,
  chosen,
  onChoose,
}: {
  readonly label: string;
  readonly chosen: boolean;
  readonly onChoose: () => void;
}): ReactNode {
  return (
    <label
      className={rowClassName({
        selected: chosen,
        className:
          'text-ui focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-focus',
      })}
    >
      <input
        className="sr-only"
        type="radio"
        name="move-target"
        checked={chosen}
        onChange={onChoose}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {chosen ? (
        <span className="inline-flex shrink-0 items-center" aria-hidden="true">
          <CheckIcon />
        </span>
      ) : null}
    </label>
  );
}

/**
 * Names a folder. It writes nothing and it creates no note.
 *
 * The folder appears in the tree at once and stays there until a note is
 * made or moved into it. The context menu of the folder row holds New note
 * in this folder and New folder in this folder.
 *
 * The dialog states the parent it will use, so a person reads where the
 * folder lands before they make it and never has to guess. `parent` comes
 * from the row that started the action, or from the selected folder for the
 * main action and the command palette.
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
          <TextField
            id="new-folder-name"
            label="Folder name"
            hint={
              parent === ''
                ? 'The folder goes at the top and starts empty. Use New note in this folder to fill it.'
                : `The folder goes inside ${parent} and starts empty. Use New note in this folder to fill it.`
            }
            value={name}
            error={error ?? undefined}
            autoFocus
            onChange={(value) => {
              nameRef.current = value;
              setName(value);
              setError(null);
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onClose}>
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

/**
 * Moves one note into a folder that already exists, or into a new one.
 *
 * The move is one store operation, so the tree and the open editor both read
 * the new path from the store. The dialog reports nothing back but its own
 * closing.
 */
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
      <form
        onSubmit={(event): void => {
          event.preventDefault();
          move();
        }}
      >
        <DialogBody>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 text-control font-medium text-strong">
              Move {displayNoteName(baseNameOf(path))} to
            </legend>
            <ul className="m-0 max-h-64 list-none overflow-y-auto p-0">
              {['', ...folders, null].map((folder) => (
                <li key={folder ?? 'new'}>
                  <FolderChoice
                    label={
                      folder === null
                        ? 'A new folder'
                        : folder === ''
                          ? 'All notes, at the top'
                          : folder
                    }
                    chosen={target === folder}
                    onChoose={() => {
                      setTarget(folder);
                      setError(null);
                    }}
                  />
                </li>
              ))}
            </ul>
          </fieldset>
          {target === null ? (
            <div className="mt-3">
              <TextField
                id="move-note-folder"
                label="New folder name"
                value={custom}
                autoFocus
                onChange={(value) => {
                  setCustom(value);
                  setError(null);
                }}
              />
            </div>
          ) : null}
          {error === null ? null : (
            <Notice className="mt-3" tone="problem" message={error} />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Move note
          </Button>
        </DialogFooter>
      </form>
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
      <form
        onSubmit={(event): void => {
          event.preventDefault();
          rename();
        }}
      >
        <DialogBody>
          <TextField
            id="rename-folder-name"
            label="Folder name"
            hint={
              count === 0
                ? 'This folder holds no note yet.'
                : `This changes the name of ${String(count)} ${count === 1 ? 'note' : 'notes'}.`
            }
            value={name}
            error={error ?? undefined}
            autoFocus
            onChange={(value) => {
              setName(value);
              setError(null);
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Rename folder
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
