/**
 * The rule of one drag of a handle (records 0098 and 0106).
 *
 * The handles of a table (`table-controls.ts`) and the grip of a list item
 * (`list-controls.ts`) both drag through this module. {@link followPointer}
 * hears the pointer on the whole window while a drag is in progress, and
 * {@link dragStep} states what each event does. The rule and
 * {@link dropPlace} are pure, so a unit test holds them.
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

/**
 * Follows one drag on the whole window until the caller stops it, and gives
 * each event to `step`. Returns the function that stops the listening.
 *
 * The release can land on any element: on the text, outside the editor, or
 * on the handle. A drag that heard the release on the handle alone, through
 * a pointer capture, missed it when the browser dropped the capture, and it
 * stayed open with its handle stuck. The window hears every release, in its
 * capture phase, before any element can stop it. Escape cancels the drag and
 * goes no further, so it closes nothing else.
 */
export function followPointer(
  target: Window,
  step: (input: DragInput) => void,
): () => void {
  const input = (type: 'move' | 'release', event: PointerEvent): DragInput => ({
    type,
    pointerId: event.pointerId,
    buttons: event.buttons,
    x: event.clientX,
    y: event.clientY,
  });
  const move = (event: PointerEvent): void => {
    step(input('move', event));
  };
  const up = (event: PointerEvent): void => {
    step(input('release', event));
  };
  const cancel = (): void => {
    step({ type: 'cancel' });
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    step({ type: 'cancel' });
  };
  const options = { capture: true } as const;
  target.addEventListener('pointermove', move, options);
  target.addEventListener('pointerup', up, options);
  target.addEventListener('pointercancel', cancel, options);
  target.addEventListener('keydown', key, options);
  target.addEventListener('blur', cancel, options);
  return (): void => {
    target.removeEventListener('pointermove', move, options);
    target.removeEventListener('pointerup', up, options);
    target.removeEventListener('pointercancel', cancel, options);
    target.removeEventListener('keydown', key, options);
    target.removeEventListener('blur', cancel, options);
  };
}

/**
 * The place that a dragged box takes in a column of boxes.
 *
 * `middles` holds the vertical middle of every box in order, the dragged box
 * included, and `from` is the place of the dragged box. The box goes below
 * every other box whose middle the pointer passed, so the place changes when
 * the pointer crosses the middle of a neighbour, whatever its height.
 */
export function dropPlace(
  middles: readonly number[],
  from: number,
  pointerY: number,
): number {
  return middles.filter((middle, index) => index !== from && pointerY > middle)
    .length;
}
