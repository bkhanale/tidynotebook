/**
 * The note list of one open area.
 *
 * The route view lists the recent notes of the workspace and offers the one
 * action that fills an empty list. The layout frame lives in `shell.tsx`; this
 * file owns the note list screen only.
 */
import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  EmptyState,
  FileTextIcon,
  Page,
  PageHeader,
  StatusRegion,
} from '@notesapp/ui';
import { useDocumentTitle } from './document-title.ts';
import { useFiles } from './files.tsx';
import { recentNotes } from './note-list.ts';
import { displayNoteName } from './note-name.ts';

/** The note list of the open area. */
export function NotesHomeView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : '';
  const files = useFiles();
  useDocumentTitle('All notes');

  const ordered = useMemo(() => recentNotes(files.notes, 200), [files.notes]);

  return (
    <Page width="wide">
      <PageHeader
        title="All notes"
        description={`${String(ordered.length)} ${ordered.length === 1 ? 'note' : 'notes'}`}
      />
      {files.loading ? (
        <StatusRegion message="Loading your notes." />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={<FileTextIcon size={32} />}
          title="No notes yet."
          description="Select New note in the sidebar, or press Cmd or Ctrl and K and select New note."
        />
      ) : (
        <ul className="m-0 list-none p-0">
          {ordered.map((note) => (
            <li key={note.fileId}>
              <Link
                to={`/w/${workspaceId}/notes/${note.fileId}`}
                className="flex min-h-11 items-center gap-3 border-b border-edge-subtle px-2 py-2 text-ink no-underline motion-safe:transition-colors hover:bg-hover"
              >
                <span
                  className="inline-flex shrink-0 items-center text-muted"
                  aria-hidden="true"
                >
                  <FileTextIcon size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-ui font-medium text-strong">
                  {displayNoteName(note.path.split('/').at(-1) ?? note.path)}
                </span>
                {note.path.includes('/') ? (
                  <span className="hidden shrink-0 text-control text-muted sm:inline">
                    {note.path.slice(0, note.path.lastIndexOf('/'))}
                  </span>
                ) : null}
                <span className="shrink-0 text-control text-muted">
                  {new Date(note.updatedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
