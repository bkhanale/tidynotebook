/**
 * Math for the Lezer Markdown parser.
 *
 * The Lezer Markdown parser that CodeMirror runs knows CommonMark and, with
 * the GFM bundle, tables, task items, strikethrough, and autolinks. It does
 * not know math. This extension adds it with the same delimiter rule that
 * `@notesapp/markdown` gives to remark, so the live preview and the reference
 * renderer open math at the same places.
 *
 * The rule, from `@notesapp/markdown`:
 *
 * - A display block opens on a line whose only content is a run of two or
 *   more dollars plus an optional info string that holds no dollar, and
 *   closes on a later line whose only content is a run of at least as many
 *   dollars. An unclosed block runs to the end of its container. The opening
 *   line ends a paragraph above it, as a code fence does.
 * - Inline math is `\(...\)` or `$...$` on one line, or a run of two or
 *   more dollars that closes on a run of its own size and can span the lines
 *   of its paragraph, as remark-math reads it. One dollar
 *   opens by the rule of Pandoc (record 0171), so a price stays text: no
 *   space after the opening dollar, no space before the closing dollar, and
 *   no digit after it. `dollarMathEnd` of `@notesapp/markdown` is the scan.
 *
 * The `\(...\)` parser is declared before `Escape`, because CommonMark reads
 * `\(` as an escaped parenthesis. Inside the delimiters a backslash escapes
 * the next character, so `\(a \) b\)` closes on the second `\)`.
 */
import {
  closingDisplayMathFence,
  dollarMathEnd,
  openingDisplayMathFence,
} from '@notesapp/markdown';
import { tags } from '@lezer/highlight';
import type {
  BlockContext,
  Element,
  InlineContext,
  Line,
  MarkdownConfig,
} from '@lezer/markdown';

/** The node that holds one display math block, fences included. */
export const mathBlockNode = 'MathBlock';

/** The node that holds one inline formula, delimiters included. */
export const inlineMathNode = 'InlineMath';

/** The node of a math delimiter run. */
export const mathMarkNode = 'MathMark';

/** The node of the formula source between the delimiters. */
export const mathTextNode = 'MathText';

const dollar = 36;
const backslash = 92;
const openParen = 40;
const closeParen = 41;
const newline = 10;

/**
 * The container depth that a parser line reports.
 *
 * `Line.depth` is how the upstream fenced code parser knows that its
 * container, for example a block quote, ended on this line. The field is
 * public in the parser but absent from its declarations, so this reader
 * proves it at run time instead of claiming it. The parameter is `object`,
 * because the reader checks the value it is given and a test can drive both
 * of its paths.
 *
 * A line without a numeric depth means that the pinned parser changed in a
 * way this extension cannot follow. That is a defect of the build, not an
 * answer a reader can use, so the refusal is loud and the unit tests of this
 * package catch it before it ships.
 */
export function containerDepth(line: object): number {
  if ('depth' in line && typeof line.depth === 'number') return line.depth;
  throw new Error(
    'The Markdown parser gave a line with no container depth. The math extension needs it to close a block at the end of its container.',
  );
}

/** The offset after the leading dollar run of a line, or -1. */
function fenceEnd(line: Line): number {
  if (line.next !== dollar) return -1;
  const fence = openingDisplayMathFence(line.text.slice(line.pos));
  if (fence === null) return -1;
  return line.pos + fence.markTo;
}

/** The offset after the last non-space character of `text`. */
function trimmedEnd(text: string): number {
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1] ?? '')) end -= 1;
  return end;
}

/** Parses one display math block, closed or not. */
function parseMathBlock(cx: BlockContext, line: Line): boolean {
  const markEnd = fenceEnd(line);
  if (markEnd < 0) return false;
  const from = cx.lineStart + line.pos;
  const openLength = markEnd - line.pos;
  const marks: Element[] = [cx.elt(mathMarkNode, from, cx.lineStart + markEnd)];
  const infoFrom = line.skipSpace(markEnd);
  const infoTo = trimmedEnd(line.text);
  if (infoFrom < infoTo)
    marks.push(
      cx.elt('CodeInfo', cx.lineStart + infoFrom, cx.lineStart + infoTo),
    );
  while (cx.nextLine() && containerDepth(line) >= cx.depth) {
    const closes = closingDisplayMathFence(
      line.text.slice(line.pos),
      openLength,
    );
    for (const marker of line.markers) marks.push(marker);
    if (closes >= 0 && line.indent - line.baseIndent < 4) {
      marks.push(
        cx.elt(
          mathMarkNode,
          cx.lineStart + line.pos,
          cx.lineStart + line.pos + closes,
        ),
      );
      cx.nextLine();
      break;
    }
    const textFrom = cx.lineStart + line.basePos;
    const textTo = cx.lineStart + line.text.length;
    if (textFrom < textTo) marks.push(cx.elt(mathTextNode, textFrom, textTo));
  }
  cx.addElement(cx.elt(mathBlockNode, from, cx.prevLineEnd(), marks));
  return true;
}

/** Where the last formula of a dollar run ended, for each inline section. */
const formulaEnds = new WeakMap<InlineContext, number>();

/**
 * Parses one inline formula in a run of two or more dollars, or answers -1.
 *
 * This is the rule of the dollar pair of remark-math, which reads it like a
 * code span: a run of dollars that no dollar stands before opens, the next
 * run of exactly as many dollars closes, and every other run and every
 * backslash inside is part of the formula (record 0001). So `$$a$$$b$` holds
 * no formula, `$$$x$$$` holds one, and `\\` before a closing run does not
 * escape it.
 *
 * A run that finds no closing run leaves its first dollar as text, and the
 * rest of the run tries again, as remark-math does: `$$$x$$` holds `$$x$$`.
 * A dollar right after a formula opens nothing, so `$a$$b$$` holds `$a$`
 * alone.
 */
function parseDollarRun(cx: InlineContext, pos: number): number {
  if (cx.char(pos - 1) === dollar && formulaEnds.get(cx) === pos) return -1;
  let open = 0;
  while (cx.char(pos + open) === dollar) open += 1;
  if (open < 2) return -1;
  const contentFrom = pos + open;
  for (let at = contentFrom; at < cx.end;) {
    const code = cx.char(at);
    if (code !== dollar) {
      at += 1;
      continue;
    }
    let run = 0;
    while (cx.char(at + run) === dollar) run += 1;
    if (run === open && at > contentFrom) {
      formulaEnds.set(cx, at + run);
      return cx.addElement(
        cx.elt(inlineMathNode, pos, at + run, [
          cx.elt(mathMarkNode, pos, contentFrom),
          cx.elt(mathTextNode, contentFrom, at),
          cx.elt(mathMarkNode, at, at + run),
        ]),
      );
    }
    at += run;
  }
  return -1;
}

/**
 * Parses one inline formula that runs from `open` to `close`.
 *
 * Returns the position after the formula, or -1 when the delimiters do not
 * close on the same line. A backslash inside the formula escapes the next
 * character, so a closing delimiter can appear as literal text.
 */
function parseInlineMath(
  cx: InlineContext,
  pos: number,
  open: readonly [number, number],
  close: readonly [number, number],
): number {
  if (cx.char(pos) !== open[0] || cx.char(pos + 1) !== open[1]) return -1;
  const contentFrom = pos + 2;
  for (let at = contentFrom; at < cx.end - 1; at += 1) {
    const code = cx.char(at);
    if (code === newline) return -1;
    if (code === close[0] && cx.char(at + 1) === close[1]) {
      if (at === contentFrom) return -1;
      return cx.addElement(
        cx.elt(inlineMathNode, pos, at + 2, [
          cx.elt(mathMarkNode, pos, contentFrom),
          cx.elt(mathTextNode, contentFrom, at),
          cx.elt(mathMarkNode, at, at + 2),
        ]),
      );
    }
    if (code === backslash) at += 1;
  }
  return -1;
}

/**
 * Parses one inline formula on one dollar, or answers -1.
 *
 * The rule and its scan are `dollarMathEnd` of `@notesapp/markdown`, which
 * reads the text of the inline section, so the characters before and after
 * each dollar are the ones the renderer reads. An escaped `\$` never reaches
 * here, because `Escape` reads the backslash first.
 */
function parseDollarMath(cx: InlineContext, pos: number): number {
  const close = dollarMathEnd(cx.text, pos - cx.offset);
  if (close < 0) return -1;
  const end = cx.offset + close;
  return cx.addElement(
    cx.elt(inlineMathNode, pos, end + 1, [
      cx.elt(mathMarkNode, pos, pos + 1),
      cx.elt(mathTextNode, pos + 1, end),
      cx.elt(mathMarkNode, end, end + 1),
    ]),
  );
}

/**
 * The math extension of the live preview parser.
 *
 * Add it to `markdown({ extensions })` next to the GFM bundle. It defines
 * four nodes and never changes an existing one, so every other construct
 * parses exactly as it did before.
 */
export const mathMarkdownExtension: MarkdownConfig = {
  defineNodes: [
    { name: mathBlockNode, block: true },
    { name: mathMarkNode, style: tags.processingInstruction },
    { name: mathTextNode, style: tags.special(tags.content) },
    { name: inlineMathNode },
  ],
  // A math fence ends the paragraph above it, as a code fence does and as
  // remark-math reads it, so a formula right under a line of text is a
  // formula on both surfaces.
  parseBlock: [
    {
      name: mathBlockNode,
      parse: parseMathBlock,
      endLeaf: (_cx, line) => fenceEnd(line) >= 0,
    },
  ],
  parseInline: [
    {
      name: 'InlineMathDollar',
      parse: (cx, next, pos) =>
        next === dollar ? parseDollarRun(cx, pos) : -1,
    },
    {
      name: 'InlineMathSingleDollar',
      parse: (cx, next, pos) =>
        next === dollar ? parseDollarMath(cx, pos) : -1,
      after: 'InlineMathDollar',
    },
    {
      name: 'InlineMathParen',
      parse: (cx, next, pos) =>
        next === backslash
          ? parseInlineMath(
              cx,
              pos,
              [backslash, openParen],
              [backslash, closeParen],
            )
          : -1,
      before: 'Escape',
    },
  ],
};
