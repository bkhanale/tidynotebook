/**
 * The marked excerpt of one search hit.
 *
 * `ts_headline` returns one string in which every matched word sits between
 * two markers. The search function uses the two lowest control characters as
 * those markers and removes both from the note body first, so this split is
 * exact. The result is a list of parts, and a reading surface renders each
 * part as text. No markup crosses the boundary, so no reader has to trust the
 * excerpt or escape it.
 */
import type { ExcerptPart } from '@notesapp/core';

/** The marker that opens a matched word in a headline. */
export const excerptStartMarker = '\u0001';

/** The marker that closes a matched word in a headline. */
export const excerptStopMarker = '\u0002';

/** Largest excerpt the contract carries, in characters and in parts. */
const maxExcerptLength = 1024;
const maxExcerptParts = 128;

/** Splits one marked headline into the parts of the contract. */
export function splitExcerpt(headline: string): readonly ExcerptPart[] {
  const parts: ExcerptPart[] = [];
  let used = 0;
  let marked = false;
  let index = 0;

  while (index < headline.length && parts.length < maxExcerptParts) {
    const marker = marked ? excerptStopMarker : excerptStartMarker;
    const at = headline.indexOf(marker, index);
    const end = at === -1 ? headline.length : at;
    const room = maxExcerptLength - used;
    if (room <= 0) break;
    const text = headline.slice(index, end).slice(0, room);
    if (text !== '') {
      parts.push({ text, marked });
      used += text.length;
    }
    if (at === -1) break;
    marked = !marked;
    index = at + marker.length;
  }

  return parts;
}
