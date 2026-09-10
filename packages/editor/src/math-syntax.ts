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
 *   dollars. An unclosed block runs to the end of its container.
 * - Inline math is `$$...$$` or `\(...\)` on one line. One dollar is money.
 *
 * The `\(...\)` parser is declared before `Escape`, because CommonMark reads
 * `\(` as an escaped parenthesis. Inside the delimiters a backslash escapes
 * the next character, so `\(a \) b\)` closes on the second `\)`.
 */
import {
  closingDisplayMathFence,
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
 * The container depth of a line.
 *
 * `Line.depth` is how the upstream fenced code parser knows that its
 * container, for example a block quote, ended on this line. The field is
 * public in the parser but not in its declarations, so this narrow view
 * names it once instead of spreading a cast through the parser.
 */
type LineWithDepth = { readonly depth: number };

/** Reads the container depth of a line. */
function containerDepth(line: Line): number {
  return (line as unknown as LineWithDepth).depth;
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
  parseBlock: [{ name: mathBlockNode, parse: parseMathBlock }],
  parseInline: [
    {
      name: 'InlineMathDollar',
      parse: (cx, next, pos) =>
        next === dollar ? parseInlineMath(cx, pos, [36, 36], [36, 36]) : -1,
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
