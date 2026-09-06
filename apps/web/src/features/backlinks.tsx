/** Backlinks and note outline panels that do not mutate editor state. */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { getBacklinks, getFile, type Backlink } from '@notesapp/api-client';
import { StatusRegion } from '@notesapp/ui';
import { problemMessage } from '../app.tsx';

/** One visible heading of a Markdown note. */
type OutlineHeading = { readonly level: number; readonly text: string };

/** Extracts ATX headings without changing or reparsing the editor document. */
export function noteOutline(source: string): readonly OutlineHeading[] {
  return source.split('\n').flatMap((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    const marks = match?.[1];
    const text = match?.[2]?.trim();
    return marks === undefined || text === undefined || text === ''
      ? []
      : [{ level: marks.length, text }];
  });
}

/** Loads and renders the accepted outline of an open note. */
export function OutlinePanel({
  workspaceId,
  fileId,
}: {
  readonly workspaceId: string;
  readonly fileId: string | null;
}): ReactNode {
  const [headings, setHeadings] = useState<readonly OutlineHeading[]>([]);
  useEffect(() => {
    if (fileId === null) {
      setHeadings([]);
      return;
    }
    let cancelled = false;
    void getFile({ path: { workspaceId, fileId } }).then((result) => {
      if (cancelled) return;
      setHeadings(noteOutline(result.data?.head?.text ?? ''));
    });
    return () => {
      cancelled = true;
    };
  }, [fileId, workspaceId]);
  if (fileId === null) return <p>Open a note to see its outline.</p>;
  if (headings.length === 0) return <p>This note has no headings.</p>;
  return (
    <ol className="notes-outline-list">
      {headings.map((heading, index) => (
        <li key={`${String(index)}:${heading.text}`}>
          <span
            style={{ paddingInlineStart: `${String(heading.level - 1)}rem` }}
          >
            {heading.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Loads access checked backlinks of the open accepted note. */
export function BacklinksPanel({
  workspaceId,
  fileId,
  onNavigate,
}: {
  readonly workspaceId: string;
  readonly fileId: string | null;
  readonly onNavigate: () => void;
}): ReactNode {
  const [backlinks, setBacklinks] = useState<readonly Backlink[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (fileId === null) {
      setBacklinks([]);
      setMessage('');
      return;
    }
    let cancelled = false;
    void getBacklinks({
      path: { workspaceId, fileId },
      query: { limit: 50 },
    }).then((result) => {
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        setBacklinks([]);
        setMessage(problemMessage(result.error));
      } else {
        setBacklinks(result.data.backlinks);
        setMessage('');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fileId, workspaceId]);
  if (fileId === null) return <p>Open a note to see its backlinks.</p>;
  if (message !== '') return <StatusRegion message={message} />;
  if (backlinks.length === 0) return <p>No accepted note links here.</p>;
  return (
    <ul>
      {backlinks.map((entry) => (
        <li key={`${entry.fileId}:${entry.sourceText}`}>
          <Link
            className="notes-tree-link"
            to={`/w/${workspaceId}/notes/${entry.fileId}`}
            onClick={onNavigate}
          >
            {entry.path}
          </Link>
          <span> {entry.sourceText}</span>
        </li>
      ))}
    </ul>
  );
}
