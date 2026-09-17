/**
 * The quiet footer of the note screen.
 *
 * It states how long the note is, from the buffer of the open editor, so the
 * count is right while the person types. The note saves itself, so the footer
 * carries no save readout; the sidebar footer states the sync progress.
 */
import type { ReactNode } from 'react';
import { noteColumnClassName } from '../../lib/note-header-layout.ts';

/** Counts the words of a Markdown buffer. */
export function wordCount(text: string): number {
  const words = text.trim().match(/\S+/gu);
  return words === null ? 0 : words.length;
}

/** The footer row of one open note. */
export function NoteFooter({ text }: { readonly text: string }): ReactNode {
  const count = wordCount(text);
  return (
    <footer className="shrink-0 border-t border-edge-line px-2 py-2 text-control text-muted">
      <div className={noteColumnClassName()}>
        <span>
          {count} {count === 1 ? 'word' : 'words'}
        </span>
      </div>
    </footer>
  );
}
