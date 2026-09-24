/**
 * The rule of one drag of a table handle, apart from the DOM (record 0098).
 *
 * `table-controls.ts` hears the pointer on the whole window while a drag is
 * in progress and asks this rule what each event does. The rule is pure, so
 * a unit test holds it.
 */

/** How far a pointer travels before a press on a handle becomes a drag. */
export const dragDistance = 4;

/** One event that a drag in progress hears on the window. */
export type DragInput =
  | {
      readonly type: 'move' | 'release';
      readonly pointerId: number;
      /** The buttons still down, as `PointerEvent.buttons` states them. */
      readonly buttons: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'cancel' };

/** What one event does to a drag: nothing, follow it, end it, or cancel it. */
export type DragStep = 'ignore' | 'follow' | 'end' | 'cancel';

/**
 * What one event does to a drag in progress.
 *
 * A release ends the drag wherever it lands, so the drag never stays open
 * after the button is up. A move with no button down is a release that never
 * reached the window, for example outside of it, and it ends the drag too.
 * Escape, a cancel of the browser and a blur of the window cancel it. Another
 * pointer takes no part, and a press becomes a drag only once the pointer
 * travels past `dragDistance`.
 */
export function dragStep(
  drag: {
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
    readonly moving: boolean;
  },
  input: DragInput,
): DragStep {
  if (input.type === 'cancel') return 'cancel';
  if (input.pointerId !== drag.pointerId) return 'ignore';
  if (input.type === 'release' || input.buttons === 0) return 'end';
  const travelled = Math.hypot(input.x - drag.startX, input.y - drag.startY);
  return drag.moving || travelled >= dragDistance ? 'follow' : 'ignore';
}
