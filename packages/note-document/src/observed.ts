/**
 * The complete observed state of a note document.
 *
 * A state vector names every insertion that a device holds, but Yjs does not
 * advance it for a deletion, so two devices can hold equal vectors and
 * different text (record 0081). Complete observed state is the vector and the
 * deletion set together, which is what a Yjs snapshot encodes. It decides
 * whether a save joins unseen accepted work, and whether Trash would hide an
 * unseen edit.
 *
 * A document generation is an epoch (record 0084). Identities of one epoch
 * say nothing about another, so a comparison across epochs has no answer.
 */
import * as Y from 'yjs';
import { loadDocument, type DocumentResult } from './document.ts';

/** The complete observed state of the document that a device holds. */
export function observeDocument(document: Uint8Array): Uint8Array {
  const doc = loadDocument(document);
  const state = Y.encodeSnapshot(Y.snapshot(doc));
  doc.destroy();
  return state;
}

/** How an observed state stands against a current document. */
export type Coverage =
  /** The device saw every insertion and deletion of the document. */
  | 'covered'
  /** The document holds an insertion or a deletion that the device lacks. */
  | 'unseen-work'
  /** The two belong to different generations, so no answer exists. */
  | 'other-epoch';

/** One observed state with the generation it belongs to. */
export type ObservedInEpoch = {
  readonly epoch: number;
  readonly state: Uint8Array;
};

/** One document with the generation it belongs to. */
export type DocumentInEpoch = {
  readonly epoch: number;
  readonly document: Uint8Array;
};

/** One deleted range of one client. */
type Range = { readonly clock: number; readonly len: number };

/** Whether every range of `inner` lies inside the union of `outer`. */
function rangesCovered(
  inner: readonly Range[],
  outer: readonly Range[],
): boolean {
  const sorted = [...outer].sort((a, b) => a.clock - b.clock);
  for (const range of inner) {
    let position = range.clock;
    const end = range.clock + range.len;
    for (const candidate of sorted) {
      if (position >= end) break;
      if (candidate.clock > position) break;
      position = Math.max(position, candidate.clock + candidate.len);
    }
    if (position < end) return false;
  }
  return true;
}

/** The snapshot of one observed state, or `null` when it does not decode. */
function decodeObserved(state: Uint8Array): Y.Snapshot | null {
  try {
    return Y.decodeSnapshot(state);
  } catch {
    return null;
  }
}

/** Whether snapshot `outer` names every insertion and deletion of `inner`. */
function snapshotCovers(outer: Y.Snapshot, inner: Y.Snapshot): boolean {
  for (const [client, clock] of inner.sv)
    if ((outer.sv.get(client) ?? 0) < clock) return false;
  for (const [client, deleted] of inner.ds.clients)
    if (!rangesCovered(deleted, outer.ds.clients.get(client) ?? []))
      return false;
  return true;
}

/**
 * Whether one observed state holds every insertion and deletion of another.
 *
 * A device writes all of its work into one document of each generation, so a
 * later save of a note observes the work of an earlier one unless the
 * document changed under it. This answers that question for two saves
 * (record 0183). Two generations, or a state that does not decode, answer
 * `false`, so a caller keeps the earlier work.
 */
export function observedCovers(
  later: ObservedInEpoch,
  earlier: ObservedInEpoch,
): boolean {
  if (later.epoch !== earlier.epoch) return false;
  const outer = decodeObserved(later.state);
  const inner = decodeObserved(earlier.state);
  if (outer === null || inner === null) return false;
  return snapshotCovers(outer, inner);
}

/**
 * Decides whether an observed state covers all work of a current document.
 *
 * Coverage, not equality: a device may hold local work that the current
 * document lacks, and that work does not make the accepted work unseen.
 */
export function observedCoverage(
  observed: ObservedInEpoch,
  current: DocumentInEpoch,
): DocumentResult<Coverage> {
  if (observed.epoch !== current.epoch)
    return { ok: true, value: 'other-epoch' };
  const seen = decodeObserved(observed.state);
  if (seen === null) return { ok: false, refusal: 'malformed' };
  const doc = loadDocument(current.document);
  const now = Y.snapshot(doc);
  doc.destroy();
  return {
    ok: true,
    value: snapshotCovers(seen, now) ? 'covered' : 'unseen-work',
  };
}
