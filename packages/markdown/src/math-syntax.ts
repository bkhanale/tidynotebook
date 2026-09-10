/**
 * The math delimiter rule of the product, in one place.
 *
 * Two engines read Markdown: remark in this package, which produces the
 * reference HTML, and the Lezer Markdown parser in `@notesapp/editor`, which
 * produces the live preview. Both must agree on where math starts and stops,
 * so the rule lives here and both import it.
 *
 * The rule:
 *
 * - A single dollar never opens math. A note that says "It costs $5 and $10
 *   today" holds prices, not a formula. `singleDollarTextMath` records that
 *   choice for the remark option of the same name.
 * - Inline math uses `$$...$$` or `\(...\)` on one line.
 * - Display math uses a `$$` fence on its own line, with an optional info
 *   string that holds no dollar sign, and closes on a later line whose only
 *   content is a run of at least as many dollars.
 *
 * This module holds no parser and no renderer. It states the rule as data and
 * as three small predicates, so a change here reaches both engines.
 */

/**
 * Whether one dollar opens inline math.
 *
 * Passed to `remark-math` as `singleDollarTextMath`. The editor applies the
 * same value in its inline math parser.
 */
export const singleDollarTextMath = false;

/** One inline math delimiter pair, as it appears in the source. */
export type InlineMathDelimiter = {
  readonly open: string;
  readonly close: string;
};

/** The inline math delimiter pairs, in the order a parser should try them. */
export const inlineMathDelimiters: readonly InlineMathDelimiter[] = [
  { open: '$$', close: '$$' },
  { open: '\\(', close: '\\)' },
];

/** The character that fences display math. */
export const displayMathFenceChar = '$';

/** The smallest display math fence, in characters. */
export const displayMathFenceMin = 2;

/** The largest indent that still starts a block, in spaces. */
const maxBlockIndent = 3;

/** Counts the leading spaces of a line, stopping at the block indent limit. */
function leadingSpaces(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === ' ') count += 1;
  return count;
}

/** An opening display math fence, with the offsets of its parts. */
export type DisplayMathFence = {
  /** Offset of the first dollar in the line. */
  readonly markFrom: number;
  /** Offset after the last dollar of the run. */
  readonly markTo: number;
  /** Offset of the first info string character, or `markTo` when there is none. */
  readonly infoFrom: number;
  /** Offset after the last info string character. */
  readonly infoTo: number;
};

/**
 * Reads an opening display math fence from one line.
 *
 * Returns null when the line does not open display math. The info string may
 * not hold a dollar sign, which is what keeps `$$x^2$$` inline math rather
 * than an empty display block.
 */
export function openingDisplayMathFence(
  line: string,
): DisplayMathFence | null {
  const indent = leadingSpaces(line);
  if (indent > maxBlockIndent) return null;
  let mark = indent;
  while (mark < line.length && line[mark] === displayMathFenceChar) mark += 1;
  if (mark - indent < displayMathFenceMin) return null;
  const rest = line.slice(mark);
  if (rest.includes(displayMathFenceChar)) return null;
  const infoFrom = mark + (rest.length - rest.trimStart().length);
  const infoTo = mark + rest.trimEnd().length;
  return { markFrom: indent, markTo: mark, infoFrom, infoTo };
}

/**
 * Reads a closing display math fence from one line.
 *
 * Returns the offset after the last dollar, or -1 when the line does not
 * close a fence of `openLength` dollars. A closing fence holds nothing but
 * dollars and trailing spaces.
 */
export function closingDisplayMathFence(
  line: string,
  openLength: number,
): number {
  const indent = leadingSpaces(line);
  if (indent > maxBlockIndent) return -1;
  let mark = indent;
  while (mark < line.length && line[mark] === displayMathFenceChar) mark += 1;
  if (mark - indent < openLength) return -1;
  if (line.slice(mark).trim() !== '') return -1;
  return mark;
}
