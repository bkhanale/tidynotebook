/**
 * The quiet footer of the note screen.
 *
 * It states two facts a writer wants without looking for them: when the
 * last version was made, and how long the note is. Both come from the
 * buffer of the open editor, so they are right while the person types.
 */
import type { ReactNode } from 'react';
import { relativeTime } from '../../lib/relative-time.ts';

/** Counts the words of a Markdown buffer. */
export function wordCount(text: string): number {
  const words = text.trim().match(/\S+/gu);
  return words === null ? 0 : words.length;
}

/** The footer row of one open note. */
export function NoteFooter({
  text,
  lastSavedAt,
  now,
}: {
  readonly text: string;
  /** When the last version was made, as an ISO instant. */
  readonly lastSavedAt: string | null;
  /** The current instant, so the row can be rendered in a test. */
  readonly now?: number | undefined;
}): ReactNode {
  const count = wordCount(text);
  const saved =
    lastSavedAt === null ? '' : relativeTime(lastSavedAt, now ?? Date.now());
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge-subtle px-4 py-2 text-control text-muted sm:px-6">
      <span>
        {count} {count === 1 ? 'word' : 'words'}
      </span>
      <span>
        {saved === '' ? 'No saved version yet' : `Last saved ${saved}`}
      </span>
    </footer>
  );
}
