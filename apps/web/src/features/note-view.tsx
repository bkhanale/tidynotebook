/**
 * One note route view.
 *
 * The unknown, purged, empty, and readable states stay distinct here, and the
 * Move to folder dialog that the note screen owns lives beside the editor. The
 * editor host that owns the one CodeMirror view is loaded lazily from
 * `note-editor.tsx`. The layout frame lives in `shell.tsx`.
 */
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Page, PageHeader, StatusRegion } from '@notesapp/ui';
import { useLocalStore, useSession } from '../app.tsx';
import { useFiles } from './files.tsx';
import { MoveNoteDialog } from './folders.tsx';
import { useDocumentTitle } from './document-title.ts';
import { displayNoteName } from './note-name.ts';

const NoteEditorLoader = lazy(async () => ({
  default: (await import('./note-editor.tsx')).NoteEditorLoader,
}));

/** One note: unknown, purged, empty, and readable states stay distinct. */
export function NoteView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const fileId = typeof params.fileId === 'string' ? params.fileId : null;
  const session = useSession();
  const store = useLocalStore();
  const files = useFiles();
  const [moveOpen, setMoveOpen] = useState(false);
  const [movedNote, setMovedNote] = useState<{
    readonly fileId: string;
    readonly path: string;
  } | null>(null);
  const moveFolders = useMemo(
    () =>
      [...new Set([...files.folders, ...files.emptyFolders])].sort(
        (left, right) => (left < right ? -1 : 1),
      ),
    [files.folders, files.emptyFolders],
  );
  const notePath =
    files.notes.find((note) => note.fileId === fileId)?.path ?? null;
  useDocumentTitle(notePath === null ? null : displayNoteName(notePath));

  if (workspaceId === null || fileId === null)
    return (
      <Page>
        <PageHeader title="Note not found" />
        <p className="m-0">
          The address names no note. It may be removed, or the address may be
          wrong. This is not an empty note.
        </p>
      </Page>
    );

  const accountId = session.account?.accountId ?? null;
  if (accountId === null)
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <StatusRegion message="Loading the note." />
      </main>
    );

  return (
    <main className="flex h-full min-w-0 flex-col">
      <Suspense fallback={<StatusRegion message="Loading the editor." />}>
        <NoteEditorLoader
          store={store.store}
          accountId={accountId}
          workspaceId={workspaceId}
          fileId={fileId}
          onMoveToFolder={() => setMoveOpen(true)}
          movedPath={movedNote?.fileId === fileId ? movedNote.path : null}
        />
      </Suspense>
      {notePath === null ? null : (
        <MoveNoteDialog
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
          store={store.store}
          accountId={accountId}
          workspaceId={workspaceId}
          notes={files.notes}
          folders={moveFolders}
          fileId={fileId}
          path={notePath}
          onMoved={(toPath) => {
            setMovedNote({ fileId, path: toPath });
            setMoveOpen(false);
          }}
        />
      )}
    </main>
  );
}
