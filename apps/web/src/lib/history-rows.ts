/**
 * The reading of one history row.
 *
 * The history screen shows a timeline: when a version was made, what it
 * changed, and one way back to it. Nothing on that screen names a revision,
 * a file, or an instant of the machine, so the text of a row is built here
 * from facts only and a unit test holds every sentence.
 */
import type { LineChangeCount } from '@notesapp/editor';

/** What one listed version changed, as far as the screen could find out. */
export type RowChange =
  /** Nothing came before this version. */
  | { readonly kind: 'first' }
  /** The version is the deletion of the note. */
  | { readonly kind: 'deleted' }
  /** The version brought an earlier text back. */
  | { readonly kind: 'restored'; readonly count: LineChangeCount | null }
  /** The version changed the text by this many lines. */
  | { readonly kind: 'edited'; readonly count: LineChangeCount }
  /** The comparison did not finish, or the text was not readable. */
  | { readonly kind: 'unknown' };

/** The line counts of one change, as a short phrase. */
export function changeCountText(count: LineChangeCount): string {
  const parts: string[] = [];
  if (count.added > 0)
    parts.push(`${String(count.added)} ${lineWord(count.added)} added`);
  if (count.removed > 0)
    parts.push(`${String(count.removed)} ${lineWord(count.removed)} removed`);
  if (parts.length === 0) return 'No line changed';
  return parts.join(', ');
}

/** `line` or `lines`, for a count. */
function lineWord(count: number): string {
  return count === 1 ? 'line' : 'lines';
}

/** One short sentence for what a listed version changed. */
export function rowChangeText(change: RowChange): string {
  if (change.kind === 'first') return 'First version';
  if (change.kind === 'deleted') return 'Note deleted';
  if (change.kind === 'restored')
    return change.count === null
      ? 'Earlier text brought back'
      : `Earlier text brought back, ${lowerFirst(changeCountText(change.count))}`;
  if (change.kind === 'edited') return changeCountText(change.count);
  return 'Text changed';
}

/** Lowers the first letter of a phrase that follows a comma. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The facts of one listed version that the row reading needs. */
export type RowFacts = {
  readonly deleted: boolean;
  readonly restored: boolean;
  /** True when no earlier version exists at all. */
  readonly first: boolean;
  /** The counts of the comparison with the version before it. */
  readonly count: LineChangeCount | null;
};

/**
 * Selects what one row reports.
 *
 * A deletion is the whole message of its version. A first version has
 * nothing to compare with. Everything else reports its line counts, and
 * says only that the text changed when the comparison did not finish.
 */
export function rowChangeOf(facts: RowFacts): RowChange {
  if (facts.deleted) return { kind: 'deleted' };
  if (facts.restored) return { kind: 'restored', count: facts.count };
  if (facts.first) return { kind: 'first' };
  if (facts.count === null) return { kind: 'unknown' };
  return { kind: 'edited', count: facts.count };
}
