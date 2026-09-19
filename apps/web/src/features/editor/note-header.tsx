/**
 * The name of the open note, in the frame header.
 *
 * The name is the last part of the breadcrumb, and it is the field a person
 * types the name into (decision 0069). The note route claims that part with
 * `HeaderLeaf`, so the frame draws no word of its own and the note surface
 * below keeps its whole height for the text.
 *
 * The reason a name cannot be kept is not here. The header row is 44 px and
 * it holds no second line, so the note screen states the reason as one
 * message on the note and this field points at it.
 */
import { useRef, type ReactNode } from 'react';
import {
  noteNameFieldClassName,
  noteNameFieldSize,
} from '../../lib/note-name-field.ts';
import { noteNameInputPolicy } from '../../lib/note-name-input.ts';
import { HeaderLeaf } from '../../shell/header-slot.tsx';

/** The id of the message that states why a name cannot be kept. */
export function noteNameErrorId(fileId: string): string {
  return `notes-path-error-${fileId}`;
}

/** The editable name of one open note. */
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
  const fallbackRef = useRef<HTMLInputElement | null>(null);

  return (
    <HeaderLeaf>
      <input
        ref={nameInputRef ?? fallbackRef}
        id={`notes-path-${fileId}`}
        className={noteNameFieldClassName()}
        type="text"
        // The field follows the name, so the hover fill covers the words and
        // not the free width of the header.
        size={noteNameFieldSize(name)}
        value={name}
        {...noteNameInputPolicy()}
        aria-label="Note name"
        aria-invalid={nameError !== ''}
        aria-describedby={
          nameError === '' ? undefined : noteNameErrorId(fileId)
        }
        placeholder="Note name"
        onChange={(event): void => onNameChange(event.target.value)}
        onBlur={onNameCommit}
        onKeyDown={(event): void => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          onNameCommit();
        }}
      />
    </HeaderLeaf>
  );
}
