/** The note outline panel, which reads the live buffer and moves the caret. */
import { useEffect, useState, type ReactNode } from 'react';
import { getFile } from '@notesapp/api-client';
import {
  outlineOf,
  previewStructureOf,
  type OutlineHeading,
} from '@notesapp/editor';
import {
  activeNoteView,
  revealInActiveNote,
  subscribeActiveNote,
} from './active-note.ts';

/** The headings of one Markdown source, read from the shared grammar. */
function outlineOfText(source: string): readonly OutlineHeading[] {
  return previewStructureOf(source).flatMap((node, index) =>
    node.kind === 'heading'
      ? [{ level: node.level, text: node.text, from: index, to: index }]
      : [],
  );
}

/** The headings of the note that is open in the editor right now. */
function liveOutline(): readonly OutlineHeading[] | null {
  const view = activeNoteView();
  return view === null ? null : outlineOf(view.state);
}

/**
 * Renders the outline of an open note.
 *
 * The rows come from the same Markdown syntax tree the editor renders, so a
 * `#` inside a code fence is code here too. While the editor is mounted the
 * panel follows the live buffer and a row moves the caret to its heading.
 * Without an editor, for example on a screen that only reads, the panel
 * falls back to the accepted server text.
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
  const [live, setLive] = useState<readonly OutlineHeading[] | null>(() =>
    liveOutline(),
  );
  const [accepted, setAccepted] = useState<readonly OutlineHeading[]>([]);
  useEffect(() => {
    setLive(liveOutline());
    return subscribeActiveNote(() => {
      setLive(liveOutline());
    });
  }, [fileId]);
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
  const movable = live !== null;
  return (
    <ol className="m-0 list-none space-y-1 p-0 text-control text-muted">
      {headings.map((heading, index) => (
        <li key={`${String(index)}:${heading.text}`}>
          {movable ? (
            <button
              type="button"
              className={`block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-inherit hover:text-strong ${indentation[heading.level - 1] ?? ''}`}
              onClick={(): void => {
                revealInActiveNote(heading.from);
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
