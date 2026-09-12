/**
 * The header row of the note screen.
 *
 * The note name is the largest type on the screen and is edited in place.
 * Next to it sit the save status, the slot where the editor puts its Write
 * and Read toggle, and one overflow menu. The row is sticky, so the name
 * and the actions stay reachable while a long note scrolls.
 *
 * The note saves itself, so there is no Save button. One quiet status reads
 * `Saving` or `Saved`, so the person knows the work is kept without acting.
 */
import { useRef, type ReactNode } from 'react';
import {
  Button,
  CheckIcon,
  HistoryIcon,
  ImageIcon,
  Menu,
  MoreIcon,
  PencilIcon,
  TrashIcon,
  type MenuItem,
} from '@notesapp/ui';
import { noteTitleClassName } from '../../lib/note-header-layout.ts';
import { statusLabel, type SaveStatus } from '../../lib/save-state.ts';

/** What the overflow menu of the note screen can do. */
export type NoteMenuHandlers = {
  readonly onHistory: () => void;
  readonly onMoveToFolder: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  /** Opens the file chooser of the editor. */
  readonly onAttachImage: () => void;
  /** Saves the note as one Markdown file on this device. */
  readonly onExport: () => void;
};

/** The sticky header of one open note. */
export function NoteHeader({
  fileId,
  name,
  nameError,
  onNameChange,
  onNameCommit,
  saveStatus,
  nameInputRef,
  readToggle,
  confirmingDelete,
  onCancelDelete,
  handlers,
}: {
  readonly fileId: string;
  readonly name: string;
  readonly nameError: string;
  readonly onNameChange: (name: string) => void;
  /** Runs when the field loses focus or the person presses Enter. */
  readonly onNameCommit: () => void;
  /** What the quiet status reports about the open note. */
  readonly saveStatus: SaveStatus;
  readonly nameInputRef?: React.Ref<HTMLInputElement> | undefined;
  /** Where the editor puts its Write and Read toggle. */
  readonly readToggle?: ReactNode | undefined;
  readonly confirmingDelete: boolean;
  readonly onCancelDelete: () => void;
  readonly handlers: NoteMenuHandlers;
}): ReactNode {
  const errorId = `notes-path-error-${fileId}`;
  const fallbackRef = useRef<HTMLInputElement | null>(null);

  const items: readonly MenuItem[] = [
    {
      id: 'history',
      label: 'History',
      icon: <HistoryIcon size={14} />,
      onSelect: handlers.onHistory,
    },
    {
      id: 'export',
      label: 'Export as Markdown',
      onSelect: handlers.onExport,
    },
    {
      id: 'attach',
      label: 'Attach image',
      icon: <ImageIcon size={14} />,
      onSelect: handlers.onAttachImage,
    },
    {
      id: 'move',
      label: 'Move to folder',
      icon: <PencilIcon size={14} />,
      onSelect: handlers.onMoveToFolder,
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      onSelect: handlers.onDuplicate,
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <TrashIcon size={14} />,
      danger: true,
      onSelect: handlers.onDelete,
    },
  ];

  return (
    <header className="sticky top-0 z-20 flex shrink-0 flex-col gap-2 border-b border-edge-subtle bg-app px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={nameInputRef ?? fallbackRef}
          id={`notes-path-${fileId}`}
          className={noteTitleClassName()}
          type="text"
          value={name}
          aria-label="Note name"
          aria-invalid={nameError !== ''}
          aria-describedby={nameError === '' ? undefined : errorId}
          placeholder="Note name"
          onChange={(event): void => onNameChange(event.target.value)}
          onBlur={onNameCommit}
          onKeyDown={(event): void => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            onNameCommit();
          }}
        />
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {readToggle}
          {confirmingDelete ? (
            <>
              <Button
                variant="danger"
                size="sm"
                icon={<TrashIcon size={14} />}
                onClick={handlers.onDelete}
              >
                Confirm delete
              </Button>
              <Button variant="secondary" size="sm" onClick={onCancelDelete}>
                Keep
              </Button>
            </>
          ) : (
            <>
              <span
                className="inline-flex items-center gap-1 px-2 text-control text-muted"
                role="status"
                aria-live="polite"
              >
                {saveStatus === 'saved' ? <CheckIcon size={14} /> : null}
                {statusLabel(saveStatus)}
              </span>
              <Menu
                label="More actions for this note"
                icon={<MoreIcon size={16} />}
                items={items}
              />
            </>
          )}
        </div>
      </div>
      {nameError === '' ? null : (
        <p
          className="m-0 px-2 text-control text-danger"
          id={errorId}
          role="alert"
        >
          {nameError}
        </p>
      )}
    </header>
  );
}
