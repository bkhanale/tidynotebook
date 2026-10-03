/**
 * The reading of the lines of an open note, kept up to date by its changes
 * (record 0182).
 *
 * The grammar gate (`./grammar-gate.ts`) asks on each change what the
 * reading of the lines of `@notesapp/markdown` says of the new note: within
 * the limits, outside them, or unsure. A reading of every line on each key
 * grows with the note, so a key in a long note took longer than the gap to
 * the next key, and the keys queued.
 *
 * The reading of a note is a sum over its parts, the runs of lines between
 * two blank lines (`measureParts`): no mark, table or part reaches over a
 * blank line, and the nesting and the size of a line are its own. A change
 * therefore moves only the parts that it touches. `measureAfter` reads those
 * parts before the change and after it, from the blank line above the change
 * to the blank line below it, takes the first reading away from the reading
 * of the note and adds the second. The answer is the reading of the whole
 * new note, and its work grows with the parts that the change touches, not
 * with the note.
 */
import type { ChangeSet, Text } from '@codemirror/state';
import { blankLine, measureParts, type PartsMeasure } from '@notesapp/markdown';

/** The line numbers of a run of whole parts, first and last included. */
export type LineSpan = { readonly first: number; readonly last: number };

/** The parts that one change touches, before and after it, in pairs. */
export type ChangedParts = readonly {
  readonly before: LineSpan;
  readonly after: LineSpan;
}[];

/** How one run of lines is read: `measureParts`, or a test that counts. */
export type ReadParts = (lines: Iterable<string>) => PartsMeasure;

/** Reads every line of a note, as an open does. */
export function measureNote(
  doc: Text,
  read: ReadParts = measureParts,
): PartsMeasure {
  return read(doc.iterLines());
}

/** The nearest blank line at or above `line`, or the first line. */
function blankAtOrAbove(doc: Text, line: number): number {
  let at = line;
  while (at > 1 && !blankLine(doc.line(at).text)) at -= 1;
  return Math.max(1, at);
}

/** The nearest blank line at or below `line`, or the last line. */
function blankAtOrBelow(doc: Text, line: number): number {
  let at = line;
  while (at < doc.lines && !blankLine(doc.line(at).text)) at += 1;
  return Math.min(doc.lines, at);
}

/**
 * The runs of whole parts that `changes` touches, in `before` and in `after`.
 *
 * A run starts at the blank line above the first line of a change and ends
 * at the blank line below its last line, or at the edge of the note. Those
 * two lines stay as they are, so the run after the change starts and ends at
 * the same lines. A change that fills a blank line or removes a line break
 * joins two parts, and the run holds both. Runs that share a line become one,
 * so no line is read twice.
 */
export function changedParts(
  before: Text,
  changes: ChangeSet,
  after: Text,
): ChangedParts {
  const spans: { first: number; last: number }[] = [];
  changes.iterChangedRanges((fromA, toA) => {
    const first = blankAtOrAbove(before, before.lineAt(fromA).number - 1);
    const last = blankAtOrBelow(before, before.lineAt(toA).number + 1);
    const previous = spans.at(-1);
    if (previous !== undefined && first <= previous.last)
      previous.last = Math.max(previous.last, last);
    else spans.push({ first, last });
  });
  return spans.map((span) => ({
    before: span,
    after: {
      first: after.lineAt(changes.mapPos(before.line(span.first).from, -1))
        .number,
      last: after.lineAt(changes.mapPos(before.line(span.last).to, 1)).number,
    },
  }));
}

/** The reading of the lines `span` of `doc`. */
function measureSpan(doc: Text, span: LineSpan, read: ReadParts): PartsMeasure {
  return read(doc.iterLines(span.first, span.last + 1));
}

/**
 * The reading of the note after `changes`, from `measure`, the reading of
 * the note before them. Only the parts that the changes touch are read.
 */
export function measureAfter(
  measure: PartsMeasure,
  before: Text,
  changes: ChangeSet,
  after: Text,
  read: ReadParts = measureParts,
): PartsMeasure {
  let bytes = measure.bytes;
  let deepLines = measure.deepLines;
  let tableCells = measure.tableCells;
  let fullParts = measure.fullParts;
  for (const pair of changedParts(before, changes, after)) {
    const gone = measureSpan(before, pair.before, read);
    const come = measureSpan(after, pair.after, read);
    bytes += come.bytes - gone.bytes;
    deepLines += come.deepLines - gone.deepLines;
    tableCells += come.tableCells - gone.tableCells;
    fullParts += come.fullParts - gone.fullParts;
  }
  return { bytes, deepLines, tableCells, fullParts };
}
