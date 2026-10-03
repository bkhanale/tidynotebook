/**
 * What an open note does when the head of its file moved (record 0179).
 *
 * The ordered feed brings the version another device wrote, a restore, or a
 * snapshot, and the local store drops a working copy that held nothing of its
 * own (record 0073). The open editor is bound to the document of the note,
 * and every change of the store joins the stored document into it, so the
 * text on the screen is the new text and the one editor stays. The editor
 * only takes the new head as the base of its next save, when nothing of this
 * device is at stake.
 *
 * A new generation of the document cannot join (record 0084). That case
 * alone reads the note again, with a new editor.
 *
 * The rules are here and not in the screen, because a rule the screen writes
 * is a rule no test can read.
 */
import type { FileSaveSnapshot } from '@notesapp/sync';

/** What one open editor knows about the note it holds. */
export type OpenNote = {
  /** Durable save facts of the file, as the local store holds them. */
  readonly snapshot: FileSaveSnapshot;
  /** The revision the next save of this editor descends from, or `null`. */
  readonly base: string | null;
  /** The buffer revision counter this editor started from. */
  readonly openedSequence: number;
  /** The buffer revision counter right now. */
  readonly currentSequence: number;
};

/**
 * The new head that the editor takes as its base, or `null` to keep it.
 *
 * Every fact must hold, and each one keeps work of this device:
 *
 * - The store holds no working copy of this file, so no text of this device
 *   waits to be written.
 * - No mutation of this file waits in the queue, and the local head is the
 *   accepted head, so no version of this device waits to be sent.
 * - The buffer carries no key of this session.
 * - The accepted head is not the base already.
 *
 * A note in Trash is not this case: the deleted state travels on its own.
 */
export function headToAdopt(open: OpenNote): string | null {
  const { snapshot } = open;
  if (snapshot.deleted) return null;
  if (snapshot.latestDraftSequence !== null) return null;
  if (snapshot.queueState !== null) return null;
  if (snapshot.localHeadRevisionId !== snapshot.acceptedHeadRevisionId)
    return null;
  if (snapshot.acceptedHeadRevisionId === null) return null;
  if (snapshot.acceptedHeadRevisionId === open.base) return null;
  if (open.currentSequence !== open.openedSequence) return null;
  return snapshot.acceptedHeadRevisionId;
}

/**
 * What the editor does with the stored document of its note.
 *
 * `join` takes the work it lacks, which is every change of the same
 * generation. `reopen` reads the note again with a new editor, for a new
 * generation and an editor with no key of this session. `keep` leaves the
 * editor as it is: a new generation under typed work, which the save then
 * meets as a refusal that record 0084 recovers.
 */
export function storedDocumentStep(input: {
  /** The generation the editor joined first, or `null` before any read. */
  readonly openedEpoch: number | null;
  readonly storedEpoch: number;
  readonly typed: boolean;
}): 'join' | 'reopen' | 'keep' {
  if (input.openedEpoch === null || input.openedEpoch === input.storedEpoch)
    return 'join';
  return input.typed ? 'keep' : 'reopen';
}

/**
 * Whether a change of another device writes the draft of this editor.
 *
 * A draft is recovery data of local work. The editor that has one keeps it
 * up with its document, so a reopen never takes the older draft for work. An
 * editor with none writes none, so a note that a person only reads holds no
 * working copy and follows the new head.
 */
export function remoteChangeWritesDraft(sequence: number): boolean {
  return sequence > 0;
}
