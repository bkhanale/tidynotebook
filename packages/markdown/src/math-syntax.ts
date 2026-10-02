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
 * - Inline math uses `$$...$$`, `\(...\)` or `$...$` on one line.
 * - One dollar opens math by the rule of Pandoc (record 0170), so a note that
 *   says "It costs $5 and $10 today" holds prices and not a formula. The
 *   opening dollar has no dollar before it, and the character after it is
 *   not a space and not a dollar. The closing dollar has a character before
 *   it that is not a space, and no digit after it. Inside the formula a
 *   backslash escapes the next character. `opensDollarMath`,
 *   `closesDollarMath` and `dollarMathEnd` state it, and an escaped `\$` is
 *   a dollar because each engine reads the escape first.
 * - Display math uses a `$$` fence on its own line, with an optional info
 *   string that holds no dollar sign, and closes on a later line whose only
 *   content is a run of at least as many dollars.
 *
 * This module holds no parser and no renderer. It states the rule as data and
 * as small predicates, so a change here reaches both engines.
 */

/**
 * Whether remark-math reads one dollar itself.
 *
 * Passed to `remark-math` as `singleDollarTextMath`. Its rule for one dollar
 * is the rule of a code span, which reads `$5 and $10` as a formula, so it
 * stays off and `./math-dollar.ts` reads one dollar by the rule above.
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
  { open: '$', close: '$' },
];

/** Whether one character is white space, or the edge of a line. */
function isSpace(character: string): boolean {
  return character === '' || /\s/.test(character);
}

/**
 * Whether one dollar opens inline math, by the characters around it.
 *
 * `before` and `after` are the characters next to the dollar, or an empty
 * text at the edge of the line.
 */
export function opensDollarMath(before: string, after: string): boolean {
  return before !== '$' && after !== '$' && !isSpace(after);
}

/**
 * Whether one dollar inside a formula closes it, by the characters around it.
 *
 * A space before it, or a digit after it, keeps the dollar in the formula, so
 * `$5 and $10` holds no closing dollar.
 */
export function closesDollarMath(before: string, after: string): boolean {
  return !isSpace(before) && !/^[0-9]$/.test(after);
}

/**
 * The offset of the dollar that closes the formula that opens at `open`, or
 * -1.
 *
 * `text` holds the dollar at `open`. The formula ends at the line, so a line
 * break before a closing dollar answers -1. This is the one scan of the rule:
 * the Lezer parser of the editor calls it, and `math-syntax.test.ts` holds
 * the micromark construct of the renderer to it.
 */
export function dollarMathEnd(text: string, open: number): number {
  if (text[open] !== '$') return -1;
  if (!opensDollarMath(text[open - 1] ?? '', text[open + 1] ?? '')) return -1;
  for (let at = open + 1; at < text.length; at += 1) {
    const character = text[at] ?? '';
    if (character === '\n' || character === '\r') return -1;
    if (character === '\\') {
      const escaped = text[at + 1] ?? '';
      if (escaped === '\n' || escaped === '\r') return -1;
      at += 1;
      continue;
    }
    if (
      character === '$' &&
      closesDollarMath(text[at - 1] ?? '', text[at + 1] ?? '')
    )
      return at;
  }
  return -1;
}

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
export function openingDisplayMathFence(line: string): DisplayMathFence | null {
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
