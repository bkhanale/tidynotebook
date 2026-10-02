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
 *
 * A note that the server does not hold has no link in the server index, so
 * that answer is an empty list and needs no request. A note that this device
 * made and has not sent yet is such a note. Before this rule the panel asked,
 * the server answered not found, and an online person read that the full
 * list needs a connection.
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

/**
 * How the panel gets the answer of the server.
 *
 * - `wait`: the note list has not said yet whether the server holds the note.
 * - `empty`: the server does not hold the note, so it holds no link to it.
 * - `ask`: the server holds the note and the device is online.
 * - `none`: the device has no connection, so no answer arrives.
 */
export type ServerBacklinkRead = 'wait' | 'empty' | 'ask' | 'none';

/** Selects how the panel gets the answer of the server. */
export function serverBacklinkRead(input: {
  /** The note list has answered, so `localOnly` is a fact. */
  readonly known: boolean;
  /** The note was made on this device and the server never accepted it. */
  readonly localOnly: boolean;
  readonly online: boolean;
}): ServerBacklinkRead {
  if (!input.known) return 'wait';
  if (input.localOnly) return 'empty';
  return input.online ? 'ask' : 'none';
}

/**
 * The rows of one server answer, or `null` when it did not arrive.
 *
 * Not found means that the server does not hold the note, so it holds no
 * link to it: the answer is an empty list and not a failed read. That covers
 * a note that the note list did not know about yet.
 */
export function serverBacklinkRows(answer: {
  readonly status: number;
  readonly rows: readonly BacklinkRow[] | null;
}): readonly BacklinkRow[] | null {
  if (answer.rows !== null) return answer.rows;
  return answer.status === 404 ? [] : null;
}

/** The sentence of an empty panel. */
export function backlinksEmptyMessage(
  partial: boolean,
  online: boolean,
): string {
  if (!partial)
    return 'No notes link here. Add a link to this note from another note.';
  return online
    ? 'This device finds no link to this note. The server did not answer.'
    : 'This device finds no link to this note. The full list needs a connection.';
}
