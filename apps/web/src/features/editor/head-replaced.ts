/**
 * The one rule that says an open note was replaced and nothing here is lost.
 *
 * The ordered feed brings the version another device wrote, and the local
 * store then drops a working copy that held nothing of its own (record 0073).
 * An editor that stays open keeps showing the text that version replaced. Its
 * next flush would put that text back on top, so the screen has to read the
 * note again instead.
 *
 * The rule is here and not in the screen, because a rule the screen writes is
 * a rule no test can read.
 */
import type { FileSaveSnapshot } from '@notesapp/sync';

/** What one open editor knows about the note it opened. */
export type OpenNote = {
  /** Durable save facts of the file, as the local store holds them. */
  readonly snapshot: FileSaveSnapshot;
  /** The revision this editor opened, or `null` for a new note. */
  readonly openedBase: string | null;
  /** The buffer revision counter this editor started from. */
  readonly openedSequence: number;
  /** The buffer revision counter right now. */
  readonly currentSequence: number;
};

/**
 * Whether the open note was replaced and the screen may read it again.
 *
 * Five facts must hold together, and each one closes a way to lose work:
 *
 * - The store holds no working copy of this file, so no text of this device
 *   waits to be written.
 * - No mutation of this file waits in the queue, and the local head is the
 *   accepted head, so no version of this device waits to be sent.
 * - The accepted head is not the revision this editor opened, so the note on
 *   the server is not the note on the screen.
 * - The buffer carries no keystroke of this session, so the text on the screen
 *   is the text that was replaced and not one the person wrote.
 *
 * A note that reached Trash is not this case. The deleted state travels on its
 * own and the screen already answers it.
 */
export function noteHeadWasReplaced(open: OpenNote): boolean {
  const { snapshot } = open;
  if (snapshot.deleted) return false;
  if (snapshot.latestDraftSequence !== null) return false;
  if (snapshot.queueState !== null) return false;
  if (snapshot.localHeadRevisionId !== snapshot.acceptedHeadRevisionId)
    return false;
  if (snapshot.acceptedHeadRevisionId === null) return false;
  if (snapshot.acceptedHeadRevisionId === open.openedBase) return false;
  return open.currentSequence === open.openedSequence;
}
