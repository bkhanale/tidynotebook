/**
 * The content area of the frame: the frame notices, then the page.
 *
 * The area scrolls a page that is taller than the screen. The note screen is
 * not such a page: its text scrolls inside it, so it takes the height that the
 * notices leave and no more. When it took the full height of the area, a
 * notice above it pushed the foot of the note under the screen, and on a
 * phone the last lines of the text stood under the keyboard. A column lets
 * the note take the rest of the area (`noteScreenClassName` in
 * `./note-column.ts`), and a page of its own height still scrolls the area.
 *
 * The rules live here, outside JSX, so a unit test can read them.
 */
import { pageRowClassName } from '@notesapp/ui';

/** The classes of the area, after the inset of the sidebar. */
export function frameContentClassName(): string {
  return 'flex min-h-0 flex-1 flex-col overflow-y-auto';
}

/** The classes of the row of the frame notices, which keeps its height. */
export function frameNoticeRowClassName(): string {
  return `${pageRowClassName()} shrink-0`;
}
