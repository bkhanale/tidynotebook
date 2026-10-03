/**
 * The field of a rename in place in the tree, as a state machine (record
 * 0164).
 *
 * F2 turns the name of a row into a field. Enter and a move away keep the
 * name, and Escape gives the old name back. The three can follow each other
 * in one gesture: Escape gives the focus back to the row, which blurs the
 * field, and a blur keeps the name. The review of the merged branch found
 * that this blur kept the words that Escape had just given up. Each event
 * therefore acts once: a field that closed or that is keeping its name
 * ignores every later event until the screen reports how the keep ended.
 *
 * The field also knows whether the focus left it, because a person who moved
 * away is somewhere else now. A second review found two faults from that:
 * a kept name took the focus back from the editor that a person clicked
 * into, and a name that a blur could not keep opened the field again with no
 * focus, so the tree took no key. A keep therefore gives the focus back to the
 * row only when the focus is still in the field, as after Enter. A refused
 * name opens the field again beside its reason when the focus is still in it,
 * and gives the old name back when the focus left it: the row keeps its name,
 * the reason stays under the tree, and F2 starts again.
 *
 * The machine is pure, so `tree-rename-field.test.ts` states each path.
 */

/** Where the field of one rename stands. */
export type RenamePhase =
  /** The person writes in the field. */
  | 'editing'
  /** The field keeps its words and waits for the write. */
  | 'keeping'
  /** The field is gone: the name was kept or given back. */
  | 'closed';

/** One field of a rename. */
export type RenameField = {
  readonly key: string;
  readonly value: string;
  readonly phase: RenamePhase;
  /** The focus left the field, so the end of the rename does not take it. */
  readonly focusLeft: boolean;
};

/** What happens to one field. */
export type RenameEvent =
  | { readonly kind: 'type'; readonly value: string }
  | { readonly kind: 'enter' }
  | { readonly kind: 'blur' }
  | { readonly kind: 'escape' }
  /**
   * The keep was refused. The field opens again beside its reason, or gives
   * the old name back when the focus left it.
   */
  | { readonly kind: 'refused' }
  /** The keep landed, or changed nothing. */
  | { readonly kind: 'kept' };

/**
 * What the screen does after one event: write the name, give the focus back
 * to the row, or nothing.
 */
export type RenameEffect = 'keep' | 'give-back' | 'none';

/** The field that F2 or Rename opens on one row. */
export function openRename(key: string, value: string): RenameField {
  return { key, value, phase: 'editing', focusLeft: false };
}

/** The next field and the one effect of an event. */
export function renameStep(
  field: RenameField,
  event: RenameEvent,
): { readonly field: RenameField; readonly effect: RenameEffect } {
  const stay = { field, effect: 'none' as const };
  switch (event.kind) {
    case 'type':
      return field.phase === 'editing'
        ? { field: { ...field, value: event.value }, effect: 'none' }
        : stay;
    case 'enter':
      return field.phase === 'editing'
        ? { field: { ...field, phase: 'keeping' }, effect: 'keep' }
        : stay;
    case 'blur':
      // A blur while the name is being kept writes nothing more, but the end
      // of the keep must not take the focus back from where it went.
      if (field.phase === 'editing')
        return {
          field: { ...field, phase: 'keeping', focusLeft: true },
          effect: 'keep',
        };
      return field.phase === 'keeping'
        ? { field: { ...field, focusLeft: true }, effect: 'none' }
        : stay;
    case 'escape':
      return field.phase === 'editing'
        ? { field: { ...field, phase: 'closed' }, effect: 'give-back' }
        : stay;
    case 'refused':
      if (field.phase !== 'keeping') return stay;
      return {
        field: { ...field, phase: field.focusLeft ? 'closed' : 'editing' },
        effect: 'none',
      };
    case 'kept':
      if (field.phase !== 'keeping') return stay;
      return {
        field: { ...field, phase: 'closed' },
        effect: field.focusLeft ? 'none' : 'give-back',
      };
  }
}
