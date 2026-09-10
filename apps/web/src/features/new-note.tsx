/**
 * Creating a note without loading the editor implementation.
 *
 * A new note starts as a local draft in the store, and the router then
 * opens the editor with the handoff state. The first Save submits the
 * creation. Until then the note lives only on this device, and the tree
 * marks it as such.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { generateUUID } from '@notesapp/core';
import {
  isLocalStorageError,
  type Draft,
  type LocalStore,
} from '@notesapp/sync';
import { Button, PlusIcon } from '@notesapp/ui';
import { displayNoteName } from './note-name.ts';
import {
  starterNoteName,
  starterNotePath,
  starterNoteText,
} from './starter-note.ts';

/** Picks a free name for a new note, without asking the person first. */
async function freeNoteName(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
): Promise<string> {
  try {
    const files = await store.listLocalFiles(accountId, workspaceId);
    const taken = new Set(files.map((file) => file.path.toLowerCase()));
    if (!taken.has('new note.md')) return 'New note.md';
    let index = 2;
    while (taken.has(`new note ${String(index)}.md`)) index += 1;
    return `New note ${String(index)}.md`;
  } catch {
    return 'New note.md';
  }
}

/** Creates one note as a local draft and opens it. */
export function useCreateNote(
  store: LocalStore | null,
  accountId: string | null,
  workspaceId: string,
): {
  readonly create: () => void;
  readonly error: string | null;
} {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const create = useCallback((): void => {
    if (store === null || accountId === null) {
      setError('Local storage is unavailable, so a note cannot be made.');
      return;
    }
    void (async (): Promise<void> => {
      const path = await freeNoteName(store, accountId, workspaceId);
      const fileId = generateUUID();
      const draft: Draft = {
        accountId,
        workspaceId,
        workingCopyId: generateUUID(),
        fileId,
        baseRevisionId: null,
        text: '',
        path,
        deleted: false,
        sequence: 1,
      };
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
  }, [store, accountId, workspaceId, navigate]);

  return { create, error };
}

/**
 * Creates the starter note of a first run.
 *
 * The note is a short Markdown document that shows what the editor can do,
 * so the first screen after sign in is a note and not an empty page.
 */
export function useStarterNote(
  store: LocalStore | null,
  accountId: string | null,
  workspaceId: string,
): {
  readonly createStarterNote: () => void;
  readonly error: string | null;
} {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const createStarterNote = useCallback((): void => {
    if (store === null || accountId === null) {
      setError('Local storage is unavailable, so a note cannot be made.');
      return;
    }
    void (async (): Promise<void> => {
      const fileId = generateUUID();
      const draft: Draft = {
        accountId,
        workspaceId,
        workingCopyId: generateUUID(),
        fileId,
        baseRevisionId: null,
        text: starterNoteText,
        path: starterNotePath,
        deleted: false,
        sequence: 1,
      };
      try {
        await store.saveDraft(draft);
      } catch {
        setError('The starter note could not be made on this device.');
        return;
      }
      setError(null);
      await navigate(`/w/${workspaceId}/notes/${fileId}`, {
        state: { noteName: starterNoteName },
      });
    })();
  }, [store, accountId, workspaceId, navigate]);

  return { createStarterNote, error };
}

/** The button that creates a new note and opens it. */
export function NewNoteButton({
  store,
  accountId,
  workspaceId,
  disabled,
  variant = 'primary',
  size = 'md',
  className,
  children,
}: {
  readonly store: LocalStore | null;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly disabled?: boolean | undefined;
  readonly variant?:
    'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle' | undefined;
  readonly size?: 'sm' | 'md' | undefined;
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
        icon={<PlusIcon size={size === 'sm' ? 14 : 16} />}
        disabled={disabled ?? store === null}
        onClick={create}
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
