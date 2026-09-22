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
  let seen: Y.Snapshot;
  try {
    seen = Y.decodeSnapshot(observed.state);
  } catch {
    return { ok: false, refusal: 'malformed' };
  }
  const doc = loadDocument(current.document);
  const now = Y.snapshot(doc);
  doc.destroy();
  for (const [client, clock] of now.sv)
    if ((seen.sv.get(client) ?? 0) < clock)
      return { ok: true, value: 'unseen-work' };
  for (const [client, deleted] of now.ds.clients)
    if (!rangesCovered(deleted, seen.ds.clients.get(client) ?? []))
      return { ok: true, value: 'unseen-work' };
  return { ok: true, value: 'covered' };
}
