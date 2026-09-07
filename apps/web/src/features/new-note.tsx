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
            const stamp = new Date()
              .toISOString()
              .replace(/[-:]/g, '')
              .replace(/\.\d{3}Z$/, '');
            const path = `untitled-${stamp}.md`;
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
            await navigate(`/w/${workspaceId}/notes/${fileId}`);
          })();
        }}
      >
        {children ?? 'New note'}
      </Button>
      {error !== null ? (
        <p className="notes-status-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
