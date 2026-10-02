/**
 * The check mark of a task box.
 *
 * Record 0033 draws a task box from the theme, with a check mark when the
 * task is done. The live preview draws it in `packages/editor`, and the
 * renderer writes the same mark beside the box of a published task, so both
 * surfaces draw one mark. The mark is the line of `CheckIcon` of the icon
 * set, on the 24 grid at a stroke of 1.5 (`packages/ui/src/icon-grid.ts`).
 */

/** The points of the one line of the check mark, on the 24 grid. */
export const taskMarkPoints = '20 6 9 17 4 12';

/** The class of the check mark in rendered HTML. */
export const taskMarkClass = 'notes-task-mark';
