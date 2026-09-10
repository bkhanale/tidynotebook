/** The note outline panel, which does not mutate editor state. */
import { useEffect, useState, type ReactNode } from 'react';
import { getFile } from '@notesapp/api-client';

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

/**
 * Renders the outline of an open note.
 *
 * `text` is the live buffer of the open editor. When it is given, the
 * outline follows what the person types. Without it the panel falls back
 * to the accepted server text, which is what a screen outside the editor
 * can read.
 */
export function OutlinePanel({
  workspaceId,
  fileId,
  text,
}: {
  readonly workspaceId: string;
  readonly fileId: string | null;
  readonly text?: string | undefined;
}): ReactNode {
  const [accepted, setAccepted] = useState<readonly OutlineHeading[]>([]);
  useEffect(() => {
    if (fileId === null || text !== undefined) {
      setAccepted([]);
      return;
    }
    let cancelled = false;
    void getFile({ path: { workspaceId, fileId } }).then((result) => {
      if (cancelled) return;
      setAccepted(noteOutline(result.data?.head?.text ?? ''));
    });
    return () => {
      cancelled = true;
    };
  }, [fileId, workspaceId, text]);
  const headings = text === undefined ? accepted : noteOutline(text);
  if (fileId === null)
    return (
      <p className="m-0 text-control text-muted">
        Open a note to see its outline.
      </p>
    );
  if (headings.length === 0)
    return (
      <p className="m-0 text-control text-muted">This note has no headings.</p>
    );
  const indentation = ['', 'pl-2', 'pl-4', 'pl-6', 'pl-8', 'pl-10'];
  return (
    <ol className="m-0 list-none space-y-1 p-0 text-control text-muted">
      {headings.map((heading, index) => (
        <li key={`${String(index)}:${heading.text}`}>
          <span
            className={`block truncate ${indentation[heading.level - 1] ?? ''}`}
          >
            {heading.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
