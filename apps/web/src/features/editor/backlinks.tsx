/** Backlinks from the accepted path-based link index. */
import { useEffect, useState, type ReactNode } from 'react';
import { listBacklinks, type Backlink } from '@notesapp/api-client';
import { Link } from 'react-router';
import { displayNoteName } from '../../lib/note-name.ts';

/** Lists notes that link to the open note. */
export function Backlinks({
  workspaceId,
  fileId,
}: {
  readonly workspaceId: string;
  readonly fileId: string;
}): ReactNode {
  const [items, setItems] = useState<readonly Backlink[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listBacklinks({ path: { workspaceId, fileId } })
      .then((answer) => {
        if (!cancelled && answer.data !== undefined)
          setItems(answer.data.backlinks);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, fileId]);
  if (items.length === 0)
    return <p className="m-0 text-control text-muted">No notes link here.</p>;
  return (
    <ul className="m-0 list-none space-y-1 p-0">
      {items.map((item) => (
        <li key={item.fileId}>
          <Link
            className="block rounded-md px-2 py-1 text-control text-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            to={`/w/${workspaceId}/notes/${item.fileId}`}
          >
            {displayNoteName(item.path)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
