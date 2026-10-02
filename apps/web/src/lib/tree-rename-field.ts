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
};

/** What happens to one field. */
export type RenameEvent =
  | { readonly kind: 'type'; readonly value: string }
  | { readonly kind: 'enter' }
  | { readonly kind: 'blur' }
  | { readonly kind: 'escape' }
  /** The keep was refused: the field opens again beside its reason. */
  | { readonly kind: 'refused' }
  /** The keep landed, or changed nothing. */
  | { readonly kind: 'kept' };

/** What the screen does after one event. */
export type RenameEffect = 'keep' | 'give-back' | 'none';

/** The field that F2 or Rename opens on one row. */
export function openRename(key: string, value: string): RenameField {
  return { key, value, phase: 'editing' };
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
    case 'blur':
      return field.phase === 'editing'
        ? { field: { ...field, phase: 'keeping' }, effect: 'keep' }
        : stay;
    case 'escape':
      return field.phase === 'editing'
        ? { field: { ...field, phase: 'closed' }, effect: 'give-back' }
        : stay;
    case 'refused':
      return field.phase === 'keeping'
        ? { field: { ...field, phase: 'editing' }, effect: 'none' }
        : stay;
    case 'kept':
      return field.phase === 'keeping'
        ? { field: { ...field, phase: 'closed' }, effect: 'none' }
        : stay;
  }
}
