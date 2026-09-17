/**
 * The header row of the note screen.
 *
 * The note name is the largest type on the screen and is edited in place. The
 * row is sticky, so the name stays reachable while a long note scrolls. The
 * note saves itself and every note action lives in the command palette, so the
 * header carries no save status and no overflow menu, and the full width goes
 * to the name.
 */
import { useRef, type ReactNode } from 'react';
import {
  noteColumnClassName,
  noteHeaderRowClassName,
  noteTitleClassName,
} from '../../lib/note-header-layout.ts';

/** The sticky header of one open note. */
export function NoteHeader({
  fileId,
  name,
  nameError,
  onNameChange,
  onNameCommit,
  nameInputRef,
}: {
  readonly fileId: string;
  readonly name: string;
  readonly nameError: string;
  readonly onNameChange: (name: string) => void;
  /** Runs when the field loses focus or the person presses Enter. */
  readonly onNameCommit: () => void;
  readonly nameInputRef?: React.Ref<HTMLInputElement> | undefined;
}): ReactNode {
  const errorId = `notes-path-error-${fileId}`;
  const fallbackRef = useRef<HTMLInputElement | null>(null);

  return (
    <header className={noteHeaderRowClassName()}>
      <div className={noteColumnClassName()}>
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
        {nameError === '' ? null : (
          <p className="m-0 text-control text-danger" id={errorId} role="alert">
            {nameError}
          </p>
        )}
      </div>
    </header>
  );
}
