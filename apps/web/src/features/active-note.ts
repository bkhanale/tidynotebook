/**
 * The editor of the note that is open, for the panels around it.
 *
 * The outline needs the live buffer, not the last saved text, and it needs a
 * way to move the caret. The note screen owns the one `EditorView` of the
 * open working copy, so it registers that view here and the panels read it.
 * Nothing in this module renders, fetches, or changes a document.
 */
import type { EditorView } from '@notesapp/editor';

/** The view of the open note, or null when no note is open. */
let current: EditorView | null = null;

/** Everyone that wants to know when the view or its text changed. */
const listeners = new Set<() => void>();

/** Tells every listener that the open note changed. */
function announce(): void {
  for (const listener of [...listeners]) listener();
}

/** Registers the view of the open note. Pass null when it closes. */
export function setActiveNoteView(view: EditorView | null): void {
  current = view;
  announce();
}

/** Reports that the text of the open note changed. */
export function activeNoteChanged(): void {
  announce();
}

/** The view of the open note, or null. */
export function activeNoteView(): EditorView | null {
  return current;
}

/** Subscribes to changes of the open note. Returns the unsubscribe. */
export function subscribeActiveNote(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Moves the caret of the open note to `position` and shows it. */
export function revealInActiveNote(position: number): void {
  const view = current;
  if (view === null) return;
  const anchor = Math.min(Math.max(position, 0), view.state.doc.length);
  view.dispatch({
    selection: { anchor },
    scrollIntoView: true,
  });
  view.focus();
}
