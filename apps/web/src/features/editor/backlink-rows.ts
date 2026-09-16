/**
 * The read state of the backlinks panel.
 *
 * A read surface holds three states and never folds one into another
 * (record 0038). This module holds that rule, so the panel renders a state
 * and decides nothing:
 *
 * - **Empty.** Both answers arrived and no note links here.
 * - **Failed.** Neither answer arrived. The panel says so and offers one
 *   action.
 * - **Partial.** This device answered and the server did not. The panel shows
 *   the rows it has and marks them.
 *
 * The server index is the authority and the device sees the unsaved draft, so
 * a row from the device replaces a row of the same note, as `mergeHits` does
 * for the command palette.
 */

/** One note that links to the note a person reads. */
export type BacklinkRow = {
  readonly fileId: string;
  readonly path: string;
};

/** What the panel renders right now. */
export type BacklinksState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly rows: readonly BacklinkRow[];
      /** True when this device answered and the server did not. */
      readonly partial: boolean;
    };

/**
 * Joins the two answers of one note.
 *
 * `null` means that the answer did not arrive. A failed read is never an empty
 * list: with no answer at all the state is `failed`, and with one answer the
 * state says which part is missing.
 */
export function backlinksState(
  server: readonly BacklinkRow[] | null,
  device: readonly BacklinkRow[] | null,
): BacklinksState {
  if (server === null && device === null) return { kind: 'failed' };
  const byFile = new Map((server ?? []).map((row) => [row.fileId, row]));
  for (const row of device ?? []) byFile.set(row.fileId, row);
  return {
    kind: 'ready',
    rows: [...byFile.values()].sort((left, right) =>
      left.path < right.path ? -1 : 1,
    ),
    partial: server === null,
  };
}
