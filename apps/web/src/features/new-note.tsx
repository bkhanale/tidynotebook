/** Creates a local-first note without loading the editor implementation. */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { generateUUID } from '@notesapp/core';
import {
  isLocalStorageError,
  type Draft,
  type LocalStore,
} from '@notesapp/sync';
import { Button, PlusIcon } from '@notesapp/ui';
import { displayNoteName } from './note-name.ts';

/**
 * Creates a new note file and opens it.
 *
 * The file starts as a local draft through the store, then the router opens
 * the editor with the handoff state. The first checkpoint submits the
 * creation. Until then, the file lives only on this device.
 */
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
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className={className}>
      <Button
        className="w-full"
        variant={variant}
        size={size}
        icon={<PlusIcon size={size === 'sm' ? 14 : 16} />}
        label="Create a new note"
        disabled={disabled ?? store === null}
        onClick={() => {
          void (async (): Promise<void> => {
            if (store === null) {
              setError('Local storage is unavailable.');
              return;
            }
            const fileId = generateUUID();
            const workingCopyId = generateUUID();
            let targetPath = 'New note.md';
            try {
              const files = await store.listLocalFiles(accountId, workspaceId);
              const existingPaths = new Set(
                files.map((file) => file.path.toLowerCase()),
              );
              if (existingPaths.has('new note.md')) {
                let index = 2;
                while (existingPaths.has(`new note ${String(index)}.md`)) {
                  index += 1;
                }
                targetPath = `New note ${String(index)}.md`;
              }
            } catch {
              // Keep the default name if reading the local file list fails.
            }
            const path = targetPath;
            const draft: Draft = {
              accountId,
              workspaceId,
              workingCopyId,
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
                isLocalStorageError(failure)
                  ? `The note could not be created on this device (${failure.kind}).`
                  : 'The note could not be created on this device.',
              );
              return;
            }
            setError(null);
            await navigate(`/w/${workspaceId}/notes/${fileId}`, {
              state: {
                focusNoteName: true,
                noteName: displayNoteName(path),
              },
            });
          })();
        }}
      >
        {children ?? 'New note'}
      </Button>
      {error !== null ? (
        <p className="text-control text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
