/**
 * The quiet footer of the note screen.
 *
 * It states how long the note is, from the buffer of the open editor, so the
 * count is right while the person types. The note saves itself, so the footer
 * carries no save readout; the sidebar footer states the sync progress.
 *
 * The row draws `edge-line` above itself. The text of a note is a region a
 * person scrolls, and the design guide draws a divider exactly there, so the
 * line states where the text stops. `noteFooterClassName` in
 * `apps/web/src/lib/note-column.ts` holds the rule, and a unit test reads it.
 */
import type { ReactNode } from 'react';
import {
  noteColumnClassName,
  noteFooterClassName,
} from '../../lib/note-column.ts';

/** Counts the words of a Markdown buffer. */
export function wordCount(text: string): number {
  const words = text.trim().match(/\S+/gu);
  return words === null ? 0 : words.length;
}

/** The footer row of one open note. */
export function NoteFooter({ text }: { readonly text: string }): ReactNode {
  const count = wordCount(text);
  return (
    <footer className={noteFooterClassName()}>
      <div className={noteColumnClassName()}>
        <span>
          {count} {count === 1 ? 'word' : 'words'}
        </span>
      </div>
    </footer>
  );
}
