/**
 * Which parked saves a later save of the same notes supersedes (record 0183).
 *
 * A parked save is a queue entry that the server refused for good. A save
 * carries the work of the device since the state the server has (record
 * 0085), so a later save of the same note carries the work of the parked save
 * as well, unless the document of the note changed under it. When the later
 * save observed every insertion and deletion of the parked save, the parked
 * save holds nothing that the later one does not, and the person needs no
 * row in Needs attention for it.
 *
 * The rule is pure. The caller supplies the coverage of two observed states,
 * because only the document package reads them, and applies the answer in
 * the transaction that accepts or parks the later save.
 */
import type { ChangesetInput, RevisionInput } from '@notesapp/core';
import type { QueueEntry } from './local-port.ts';

/** The complete observed state of one save, with its generation. */
export type ObservedSave = {
  readonly epoch: number;
  readonly state: Uint8Array;
};

/** Whether the later observed state holds all work of the earlier one. */
export type ObservedCovers = (
  later: ObservedSave,
  earlier: ObservedSave,
) => boolean;

/**
 * The observed state of one live save of note work, or `null`.
 *
 * A deletion, an attachment and a write that names no observed state are not
 * work that a later save of the note can carry.
 */
function observedOf(revision: RevisionInput): ObservedSave | null {
  if (revision.deleted || revision.content.kind !== 'markdown') return null;
  const save = revision.content.document;
  if (save.work.kind !== 'update' || save.observed === null) return null;
  return { epoch: save.epoch, state: save.observed };
}

/** The last revision of each file of one changeset. */
function tipsOf(input: ChangesetInput): ReadonlyMap<string, RevisionInput> {
  const tips = new Map<string, RevisionInput>();
  for (const revision of input.revisions) tips.set(revision.fileId, revision);
  return tips;
}

/**
 * Whether `later` supersedes the parked entry `parked`.
 *
 * Each revision of the parked entry must be a live save of note work, and the
 * last revision of its note in the later save must be one too, of the same
 * generation, with an observed state that covers it. A parked entry that
 * names a note the later save does not touch stays.
 */
export function supersedes(
  later: ChangesetInput,
  parked: QueueEntry,
  covers: ObservedCovers,
): boolean {
  if (parked.state !== 'conflict') return false;
  if (parked.input.mutationId === later.mutationId) return false;
  if (parked.input.workspaceId !== later.workspaceId) return false;
  if (parked.input.revisions.length === 0) return false;
  const tips = tipsOf(later);
  return parked.input.revisions.every((revision) => {
    const earlier = observedOf(revision);
    if (earlier === null) return false;
    const tip = tips.get(revision.fileId);
    if (tip === undefined) return false;
    const seen = observedOf(tip);
    return seen !== null && covers(seen, earlier);
  });
}

/** The mutation identities of the parked entries that `later` supersedes. */
export function supersededSaves(
  later: ChangesetInput,
  entries: readonly QueueEntry[],
  covers: ObservedCovers,
): readonly string[] {
  return entries
    .filter((entry) => supersedes(later, entry, covers))
    .map((entry) => entry.input.mutationId);
}
