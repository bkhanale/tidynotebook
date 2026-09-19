/**
 * The quiet footer of the note screen.
 *
 * It states how long the note is, from the buffer of the open editor, so the
 * count is right while the person types. The note saves itself, so the footer
 * carries no save readout; the sidebar footer states the sync progress.
 *
 * The row draws no rule above itself. One quiet sentence under the text of a
 * note is not a region a person scrolls, so space separates it and nothing
 * else does (record 0064 and the design guide).
 */
import type { ReactNode } from 'react';
import { noteColumnClassName } from '../../lib/note-column.ts';

/** Counts the words of a Markdown buffer. */
export function wordCount(text: string): number {
  const words = text.trim().match(/\S+/gu);
  return words === null ? 0 : words.length;
}

/** The footer row of one open note. */
export function NoteFooter({ text }: { readonly text: string }): ReactNode {
  const count = wordCount(text);
  return (
    <footer className="shrink-0 px-2 py-2 text-control text-muted">
      <div className={noteColumnClassName()}>
        <span>
          {count} {count === 1 ? 'word' : 'words'}
        </span>
      </div>
    </footer>
  );
}
