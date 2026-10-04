/**
 * The caret stays in view when the text gets shorter while a person types.
 *
 * On a phone, a tap on a line low in the note opens the keyboard, and the
 * frame shrinks to the part of the screen above it. The text kept its scroll
 * position, so the line of the caret stood under the keyboard until the first
 * key. The same happens when the footer or a panel takes room from the text.
 * When the height of the text shrinks while it has the focus, the editor
 * brings the caret back into view by the shortest scroll.
 *
 * {@link keepsCaretInView} is the pure rule, so a unit test holds it.
 */
import { type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/** Whether a change of the height of the text asks to show the caret. */
export function keepsCaretInView(change: {
  readonly before: number;
  readonly after: number;
  readonly focused: boolean;
}): boolean {
  return change.focused && change.after < change.before;
}

/** The extension that keeps the caret in view. */
export function caretInView(): Extension {
  return ViewPlugin.fromClass(
    class {
      readonly view: EditorView;
      height: number;
      destroyed = false;
      constructor(view: EditorView) {
        this.view = view;
        this.height = view.scrollDOM.clientHeight;
      }
      update(update: ViewUpdate): void {
        if (!update.geometryChanged) return;
        const before = this.height;
        const after = update.view.scrollDOM.clientHeight;
        this.height = after;
        if (!keepsCaretInView({ before, after, focused: update.view.hasFocus }))
          return;
        // A view takes no new transaction while it updates, so the scroll
        // goes out once this update ends.
        queueMicrotask(() => {
          if (this.destroyed) return;
          const view = this.view;
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.selection.main.head, {
              y: 'nearest',
            }),
          });
        });
      }
      destroy(): void {
        this.destroyed = true;
      }
    },
  );
}
