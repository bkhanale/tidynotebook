/**
 * One note route view.
 *
 * The unknown, purged, empty, and readable states stay distinct here. The two
 * dialogs that the note screen owns, Move to folder and Publish, live beside
 * the editor. Both open from the command palette, which is where every action
 * of the open note lives, so the note surface itself gains no control.
 *
 * Move to folder writes through the store, and the editor reads the new path
 * from the note list, so this screen carries no path of its own. Publish calls
 * one generated operation and shows the new link one time. The editor host
 * that owns the one CodeMirror view is loaded lazily from `note-editor.tsx`.
 * The layout frame lives in `shell.tsx`.
 */
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  buttonClassName,
  ChevronLeftIcon,
  LoadingState,
  Page,
  pageGutter,
  PageHeader,
} from '@notesapp/ui';
import { useLocalStore, useSession } from '../../app.tsx';
import { useFiles } from '../../shell/files.tsx';
import { MoveNoteDialog } from '../folders/folders.tsx';
import { PublishDialog } from '../publishing/publish-dialog.tsx';
import { useDocumentTitle } from '../../shell/document-title.ts';
import { displayNoteName } from '../../lib/note-name.ts';

const NoteEditorLoader = lazy(async () => ({
  default: (await import('../editor/note-loader.tsx')).NoteEditorLoader,
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
  const [publishOpen, setPublishOpen] = useState(false);
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
        <p className="mb-6 mt-0 text-control text-muted">
          This address does not match a note. The note may be deleted, or the
          link may be wrong.
        </p>
        <Link
          className={buttonClassName({ variant: 'secondary' })}
          to={workspaceId === null ? '/' : `/w/${workspaceId}`}
        >
          <span className="inline-flex items-center" aria-hidden="true">
            <ChevronLeftIcon />
          </span>
          <span>Back to your notes</span>
        </Link>
      </Page>
    );

  const accountId = session.account?.accountId ?? null;
  if (accountId === null)
    return (
      <main className={`mx-auto w-full max-w-3xl ${pageGutter} py-6`}>
        <LoadingState shape="note" label="The note is loading." />
      </main>
    );

  return (
    <main className="flex h-full min-w-0 flex-col">
      <Suspense
        fallback={
          <div className={`mx-auto w-full max-w-3xl ${pageGutter} py-6`}>
            <LoadingState shape="note" label="The editor is loading." />
          </div>
        }
      >
        <NoteEditorLoader
          store={store.store}
          accountId={accountId}
          workspaceId={workspaceId}
          fileId={fileId}
          onMoveToFolder={() => setMoveOpen(true)}
          onPublish={() => setPublishOpen(true)}
        />
      </Suspense>
      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        workspaceId={workspaceId}
        scope={{ kind: 'note', fileId }}
        notes={files.notes}
      />
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
        />
      )}
    </main>
  );
}
