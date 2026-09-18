/**
 * The note list of one open area.
 *
 * The screen has one job and one primary button for it. New note sits in the
 * page header, where the one action of a route belongs (decision 0062), and
 * the sidebar holds a row instead of a second filled button.
 *
 * The notes group by how recently they changed. A group label is a quiet
 * heading in sentence case, and the rows under it separate by space and by
 * fill and never by a rule (decision 0063). Each row is the one row recipe of
 * the product, so a note of this list, a note of the tree and a row of a menu
 * are one size, one radius and one focus treatment (decision 0065).
 *
 * The layout frame lives in `shell.tsx`; this file owns the note list screen
 * only.
 */
import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  Button,
  EmptyState,
  FileTextIcon,
  LoadingState,
  Notice,
  Page,
  PageHeader,
  PlusIcon,
  rowClassName,
} from '@notesapp/ui';
import { useLocalStore, useSession } from '../../app.tsx';
import { useDocumentTitle } from '../../shell/document-title.ts';
import { useFiles } from '../../shell/files.tsx';
import { useCreateNote } from './new-note.tsx';
import { groupNotesByRecency } from '../../lib/note-groups.ts';
import { noteRowMeta } from '../../lib/note-row.ts';

/** The quiet heading of one time band of the list. */
const groupLabelClassName =
  'px-2 pb-1 pt-4 text-control font-medium text-muted';

/** The note list of the open area. */
export function NotesHomeView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : '';
  const files = useFiles();
  const session = useSession();
  const store = useLocalStore();
  const accountId = session.account?.accountId ?? null;
  const newNote = useCreateNote(store.store, accountId, workspaceId);
  useDocumentTitle('All notes');

  const now = Date.now();
  const groups = useMemo(
    () => groupNotesByRecency(files.notes, now),
    [files.notes, now],
  );
  const total = files.notes.length;

  return (
    <Page width="wide">
      <PageHeader
        title="All notes"
        description={`${String(total)} ${total === 1 ? 'note' : 'notes'}`}
        actions={
          <Button
            icon={<PlusIcon />}
            disabled={store.store === null}
            onClick={() => newNote.create()}
          >
            New note
          </Button>
        }
      />
      {newNote.error === null ? null : (
        <Notice className="mb-4" tone="problem" message={newNote.error} />
      )}
      {files.loading ? (
        <LoadingState shape="list" rows={6} label="Your notes are loading." />
      ) : total === 0 ? (
        <EmptyState
          icon={<FileTextIcon size={20} />}
          title="No notes yet"
          description="Write your first note to fill this space."
          action={
            <Button
              icon={<PlusIcon />}
              disabled={store.store === null}
              onClick={() => newNote.create()}
            >
              New note
            </Button>
          }
        />
      ) : (
        <div>
          {groups.map((group) => (
            <section key={group.label} aria-labelledby={`group-${group.label}`}>
              <h2 className={groupLabelClassName} id={`group-${group.label}`}>
                {group.label}
              </h2>
              <ul className="m-0 list-none p-0">
                {group.notes.map((note) => {
                  const meta = noteRowMeta(note.path, note.updatedAt, now);
                  return (
                    // The list item stays a list item and the router link
                    // fills it, the shape that `ListRow` renders for a plain
                    // address. This row needs the router and not the
                    // platform, so it reads the row recipe directly.
                    <li className="flex" key={note.fileId}>
                      <Link
                        className={rowClassName({
                          inset: false,
                          className: 'min-w-0 flex-1',
                        })}
                        to={`/w/${workspaceId}/notes/${note.fileId}`}
                        aria-label={
                          meta.folder === null
                            ? meta.name
                            : `${meta.name}, in ${meta.folder}`
                        }
                      >
                        <span
                          className="inline-flex shrink-0 items-center text-muted"
                          aria-hidden="true"
                        >
                          <FileTextIcon />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ui text-strong">
                          {meta.name}
                        </span>
                        <span className="shrink-0 text-control text-muted">
                          {meta.when}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
