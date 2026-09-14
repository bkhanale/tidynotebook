/** The note outline panel, which reads the live buffer and moves the caret. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getFile } from '@notesapp/api-client';
import {
  outlineOf,
  previewStructureOf,
  type OutlineHeading,
} from '@notesapp/editor';
import { revealInNote, useActiveNote } from './active-note.tsx';

/** The headings of one Markdown source, read from the shared grammar. */
function outlineOfText(source: string): readonly OutlineHeading[] {
  return previewStructureOf(source).flatMap((node, index) =>
    node.kind === 'heading'
      ? [{ level: node.level, text: node.text, from: index, to: index }]
      : [],
  );
}

/**
 * Renders the outline of an open note.
 *
 * The rows come from the same Markdown syntax tree the editor renders, so a
 * `#` inside a code fence is code here too. The panel sits in the scope of the
 * open note: while its editor is mounted the panel follows the live buffer and
 * a row moves the caret to its heading. Until the editor opens, the panel
 * falls back to the text it is given, or to the accepted server text.
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
  // The scope gives a new value when the editor opens, when it closes, and
  // when the text moves on, so the rows below follow the live buffer. The
  // count is the reason to read the buffer again, so the walk of the syntax
  // tree happens once for each change and not once for each render.
  const { view, revision } = useActiveNote();
  const live = useMemo(
    () => (view === null ? null : outlineOf(view.state)),
    [view, revision],
  );
  const [accepted, setAccepted] = useState<readonly OutlineHeading[]>([]);
  useEffect(() => {
    if (fileId === null || text !== undefined) {
      setAccepted([]);
      return;
    }
    let cancelled = false;
    void getFile({ path: { workspaceId, fileId } }).then((result) => {
      if (cancelled) return;
      setAccepted(outlineOfText(result.data?.head?.text ?? ''));
    });
    return () => {
      cancelled = true;
    };
  }, [fileId, workspaceId, text]);
  const headings =
    live ?? (text === undefined ? accepted : outlineOfText(text));
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
          {view !== null ? (
            <button
              type="button"
              className={`block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-inherit hover:text-strong ${indentation[heading.level - 1] ?? ''}`}
              onClick={(): void => {
                revealInNote(view, heading.from);
              }}
            >
              {heading.text}
            </button>
          ) : (
            <span
              className={`block truncate ${indentation[heading.level - 1] ?? ''}`}
            >
              {heading.text}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
