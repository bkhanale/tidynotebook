/**
 * The caret stays in view when the text gets shorter while a person types.
 *
 * On a phone, a tap on a line low in the note opens the keyboard, and the
 * frame shrinks to the part of the screen above it. The text kept its scroll
 * position, so the line of the caret stood under the keyboard until the first
 * key. When the height of the text shrinks while it has the focus, and the
 * caret was in view before and is not now, the editor brings it back into
 * view by the shortest scroll. A caret that the person scrolled away from
 * stays where it is, so a reading place is never lost.
 *
 * {@link keepsCaretInView} is the pure rule, so a unit test holds it.
 */
import { type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

/**
 * Whether a change of the height of the text asks to show the caret.
 *
 * `caretTop` and `caretBottom` are the edges of the caret from the top of
 * the visible text. The text shrinks from its foot, so they stay the same.
 */
export function keepsCaretInView(change: {
  readonly before: number;
  readonly after: number;
  readonly focused: boolean;
  readonly caretTop: number;
  readonly caretBottom: number;
}): boolean {
  const { before, after, focused, caretTop, caretBottom } = change;
  if (!focused || after >= before) return false;
  const shownBefore = caretTop >= 0 && caretBottom <= before;
  return shownBefore && caretBottom > after;
}

/** The extension that keeps the caret in view. */
export function caretInView(): Extension {
  return ViewPlugin.fromClass(
    class {
      readonly observer: ResizeObserver;
      height: number;
      constructor(view: EditorView) {
        const scroller = view.scrollDOM;
        this.height = scroller.clientHeight;
        // An observer runs only when the size of the text changes, and
        // outside an update of the view, so the scroll can go out at once.
        this.observer = new ResizeObserver(() => {
          const before = this.height;
          const after = scroller.clientHeight;
          this.height = after;
          if (after >= before || !view.hasFocus) return;
          const head = view.state.selection.main.head;
          const caret = view.coordsAtPos(head);
          if (caret === null) return;
          const top = scroller.getBoundingClientRect().top;
          const show = keepsCaretInView({
            before,
            after,
            focused: true,
            caretTop: caret.top - top,
            caretBottom: caret.bottom - top,
          });
          if (show)
            view.dispatch({
              effects: EditorView.scrollIntoView(head, { y: 'nearest' }),
            });
        });
        this.observer.observe(scroller);
      }
      destroy(): void {
        this.observer.disconnect();
      }
    },
  );
}
