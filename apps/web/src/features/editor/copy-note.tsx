/**
 * Copy this note as Markdown on the open note.
 *
 * The palette offers the action, and the open note runs it, because it owns
 * the one editor view of its working copy. The rule and its sentences live in
 * `lib/copy-note.ts`. The palette closes before the action runs, so the
 * sentence of the result shows in the one `Toast` of `@notesapp/ui` and goes
 * away by itself.
 */
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { EditorView } from '@notesapp/editor';
import { Toast } from '@notesapp/ui';
import { copyNote, copyNoticeMs } from '../../lib/copy-note.ts';
import { copyText } from '../../platform.ts';

/** The copy action of the open note and the toast that states its result. */
export function useCopyNote(viewRef: RefObject<EditorView | null>): {
  readonly run: () => void;
  readonly toast: ReactNode;
} {
  // Each copy holds a new object, even when its sentence is the same as the
  // last one. React skips a state that is equal to the last, and a string
  // that repeats would keep the wait of the first copy.
  const [notice, setNotice] = useState<{ readonly message: string } | null>(
    null,
  );

  // The text comes from the one editor view of this working copy, so the
  // copy holds every edit, saved or not.
  const run = useCallback((): void => {
    const view = viewRef.current;
    if (view === null) return;
    void copyNote(view.state.doc.toString(), copyText).then((message) => {
      setNotice({ message });
    });
  }, [viewRef]);

  // A second copy starts the wait again, because it states its own result.
  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => {
      setNotice(null);
    }, copyNoticeMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  return {
    run,
    toast: notice === null ? null : <Toast message={notice.message} />,
  };
}
