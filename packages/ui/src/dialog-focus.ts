/**
 * Where the focus goes when a dialog closes.
 *
 * A dialog gives the focus back to the element that opened it, so a person
 * who closes it goes on where they were. The act of a dialog can remove that
 * element: Move to folder takes away the row of the tree that opened it when
 * the row moves into a closed folder, and a focus given to a removed element
 * falls to the page. A caller whose opener can leave therefore names the
 * place itself, and that place wins over the opener.
 *
 * The rule is a module of its own, because Node loads no `.tsx` file and
 * `dialog-focus.test.ts` states it.
 */

/** Gives the focus back after a dialog closes. */
export function giveFocusBack(
  opener: { focus(): void } | null,
  returnFocus: (() => void) | undefined,
): void {
  if (returnFocus === undefined) opener?.focus();
  else returnFocus();
}
