/**
 * The two confirmation dialogs for a sidebar deletion.
 *
 * One dialog names the note and one names the folder. Each states the outcome
 * before it writes and reports one cause when the deletion fails. The write
 * itself lives in `note-delete.ts`.
 */
import type { ReactNode } from 'react';
import { Button, Dialog, DialogBody, DialogFooter } from '@notesapp/ui';

/** Confirms that one note moves to the trash. */
export function DeleteNoteDialog({
  open,
  name,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  readonly open: boolean;
  readonly name: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Delete ${name}?`}
      titleId="delete-note-title"
      width="small"
    >
      <DialogBody>
        <p className="m-0 text-ui text-ink">
          The note moves to Trash. You can restore it from Trash.
        </p>
        {error === null ? null : (
          <p className="mb-0 mt-3 text-control text-danger" role="alert">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          Delete note
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Confirms that every note under one folder moves to the trash. */
export function DeleteFolderDialog({
  open,
  folder,
  count,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  readonly open: boolean;
  readonly folder: string;
  readonly count: number;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  const notes = count === 1 ? '1 note' : `${String(count)} notes`;
  const body =
    count === 0
      ? 'This folder holds no notes. It leaves the tree.'
      : `${notes} in this folder ${count === 1 ? 'moves' : 'move'} to Trash. You can restore them from Trash.`;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Delete ${folder}?`}
      titleId="delete-folder-title"
      width="small"
    >
      <DialogBody>
        <p className="m-0 text-ui text-ink">{body}</p>
        {error === null ? null : (
          <p className="mb-0 mt-3 text-control text-danger" role="alert">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          Delete folder
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
