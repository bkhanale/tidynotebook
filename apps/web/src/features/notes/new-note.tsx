/**
 * Creating a note without loading the editor implementation.
 *
 * A new note starts as an empty local draft in the store, and the router then
 * opens the editor with the handoff state. The first Save submits the
 * creation. Until then the note lives only on this device, and the tree marks
 * it as such. The rules of the draft itself live in `new-note-draft.ts`.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { generateUUID } from '@notesapp/core';
import { isLocalStorageError, type LocalStore } from '@notesapp/sync';
import {
  Button,
  PlusIcon,
  type ButtonSize,
  type ButtonVariant,
} from '@notesapp/ui';
import { freeNotePath, newNoteDraft } from '../../lib/new-note-draft.ts';
import { displayNoteName } from '../../lib/note-name.ts';

/** Creates one empty note and opens it. */
export function useCreateNote(
  store: LocalStore | null,
  accountId: string | null,
  workspaceId: string,
): {
  /** Creates the note in the named folder, or at the root for an empty name. */
  readonly create: (folder?: string) => void;
  readonly error: string | null;
} {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    (folder = ''): void => {
      if (store === null || accountId === null) {
        setError('Local storage is unavailable, so a note cannot be made.');
        return;
      }
      void (async (): Promise<void> => {
        let taken: readonly string[] = [];
        try {
          const files = await store.listLocalFiles(accountId, workspaceId);
          taken = files.map((file) => file.path);
        } catch {
          taken = [];
        }
        const path = freeNotePath(taken, folder);
        const fileId = generateUUID();
        const draft = newNoteDraft({
          accountId,
          workspaceId,
          path,
          ids: { fileId, workingCopyId: generateUUID() },
        });
        try {
          await store.saveDraft(draft);
        } catch (failure: unknown) {
          setError(
            isLocalStorageError(failure) && failure.kind === 'quota'
              ? 'This device is full, so the note was not made. Free space and try again.'
              : 'The note could not be made on this device.',
          );
          return;
        }
        setError(null);
        await navigate(`/w/${workspaceId}/notes/${fileId}`, {
          state: { focusNoteName: true, noteName: displayNoteName(path) },
        });
      })();
    },
    [store, accountId, workspaceId, navigate],
  );

  return { create, error };
}

/** The button that creates a new note in the selected folder and opens it. */
export function NewNoteButton({
  store,
  accountId,
  workspaceId,
  folder,
  disabled,
  variant = 'primary',
  size = 'md',
  className,
  children,
}: {
  readonly store: LocalStore | null;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly folder?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode | undefined;
}): ReactNode {
  const { create, error } = useCreateNote(store, accountId, workspaceId);

  return (
    <div className={className}>
      <Button
        className="w-full"
        variant={variant}
        size={size}
        icon={<PlusIcon />}
        disabled={disabled ?? store === null}
        onClick={() => create(folder)}
      >
        {children ?? 'New note'}
      </Button>
      {error === null ? null : (
        <p className="mt-1 text-control text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
