/**
 * Keeps the one character that a save wrote into a slot (record 0134).
 *
 * Two devices that replace one character before either sees the other each
 * insert a character, and the document keeps both. A slot is a range of text
 * that must hold one character, such as the state of a task box. The caller
 * finds the slots, because only it knows the grammar of the text. This module
 * knows which character of a slot the last save wrote, because only the
 * document knows the identity of each character.
 */
import * as Y from 'yjs';
import { documentBounds, type DocumentBounds } from './bounds.ts';
import {
  loadDocument,
  noteTextRoot,
  type AppliedDocument,
  type DocumentResult,
} from './document.ts';

/** A range of text, as offsets in UTF-16 code units, `to` excluded. */
export type TextSlot = {
  readonly from: number;
  readonly to: number;
};

/** Whether the document before the save already held one character. */
type HeldBefore = (client: number, clock: number) => boolean;

/** The identity test of the characters that `before` holds. */
function heldBefore(before: Uint8Array): HeldBefore {
  const doc = loadDocument(before);
  const vector = Y.decodeStateVector(Y.encodeStateVector(doc));
  doc.destroy();
  return (client, clock) => clock < (vector.get(client) ?? 0);
}

/** Who wrote one visible character, and whether the save wrote it. */
type Author = { readonly client: number; readonly written: boolean };

/**
 * The author of each visible character of a text, in text order.
 *
 * Index `n` is the character at offset `n`. A Yjs string item holds a run of
 * characters of one client with consecutive clocks.
 */
function authors(text: Y.Text, held: HeldBefore): readonly Author[] {
  const found: Author[] = [];
  for (let item = text._start; item !== null; item = item.right) {
    if (item.deleted || !item.countable) continue;
    if (!(item.content instanceof Y.ContentString)) continue;
    for (let offset = 0; offset < item.length; offset += 1)
      found.push({
        client: item.id.client,
        written: !held(item.id.client, item.id.clock + offset),
      });
  }
  return found;
}

/**
 * Leaves one character in each slot that two editors wrote into.
 *
 * `before` is the document before the save and `after` is the document with
 * the save applied. A slot changes only when the save wrote a character into
 * it and its characters come from more than one editor, which is how two
 * replacements that crossed look, whether they met on the server or on the
 * device before it saved. The last character that the save wrote stays, and
 * every other character of the slot is deleted. A slot that one editor wrote
 * alone stays as the person wrote it. The deletions are the only work, so
 * they merge with any later work, and a repeat of them changes nothing.
 */
export function keepWrittenCharacter(
  before: Uint8Array,
  after: Uint8Array,
  slots: readonly TextSlot[],
  bounds: DocumentBounds = documentBounds,
): DocumentResult<AppliedDocument> {
  const doc = loadDocument(after);
  try {
    const text = doc.getText(noteTextRoot);
    const found = authors(text, heldBefore(before));
    const removed: number[] = [];
    for (const slot of slots) {
      const offsets: number[] = [];
      for (let offset = slot.from; offset < slot.to; offset += 1)
        offsets.push(offset);
      const kept = offsets.findLast(
        (offset) => found[offset]?.written === true,
      );
      if (kept === undefined) continue;
      const editors = new Set(offsets.map((offset) => found[offset]?.client));
      if (editors.size < 2) continue;
      removed.push(...offsets.filter((offset) => offset !== kept));
    }
    // A save that changes no slot keeps the bytes that it was given.
    if (removed.length === 0)
      return { ok: true, value: { document: after, text: text.toJSON() } };
    // From the end of the text, so every offset still names its character.
    removed.sort((one, other) => other - one);
    doc.transact(() => {
      for (const offset of removed) text.delete(offset, 1);
    });
    const next = Y.encodeStateAsUpdate(doc);
    if (next.byteLength > bounds.maxDocumentBytes)
      return { ok: false, refusal: 'too-large' };
    return { ok: true, value: { document: next, text: text.toJSON() } };
  } finally {
    doc.destroy();
  }
}
