/**
 * GFM footnotes for the Lezer Markdown parser (record 0156).
 *
 * The parser that CodeMirror runs knows CommonMark and, with the GFM bundle,
 * tables, task items, strikethrough and autolinks, but no footnote. remark
 * reads GFM footnotes, so the published page drew a footnote where the
 * editor showed `[^n]` text and read a definition as a link reference. This
 * extension adds both with the label rule of `@notesapp/markdown`:
 *
 * - A definition is a container block. It starts with `[^label]:` under four
 *   columns of indentation, and the blank lines, the lines indented four
 *   columns and the lazy lines of its paragraph continue it, as a list item
 *   continues. The start of a definition ends a paragraph above it.
 * - A reference is the inline `[^label]`.
 *
 * Whether a reference names a definition of the note is a question about the
 * whole note, so the live preview answers it from the tree and not this
 * parser, which reads one line at a time.
 */
import { footnoteLabelEnd, footnoteLabelOpen } from '@notesapp/markdown';
import { tags } from '@lezer/highlight';
import type {
  BlockContext,
  InlineContext,
  Line,
  MarkdownConfig,
} from '@lezer/markdown';

/** The container node of one footnote definition. */
export const footnoteDefinitionNode = 'FootnoteDefinition';

/** The node of one footnote reference, brackets included. */
export const footnoteReferenceNode = 'FootnoteReference';

/** The node of `[^`, `]` or `]:` around a label. */
export const footnoteMarkNode = 'FootnoteMark';

/** The node of the label between the marks. */
export const footnoteLabelNode = 'FootnoteLabel';

/** The node of a blank line that a definition holds. */
export const footnoteBlankNode = 'FootnoteBlank';

const openBracket = 91;
const caret = 94;
const colon = 58;

/** The width of indentation that continues a definition. */
const definitionIndent = 4;

/** The offset of the `]` that ends the label of a definition, or -1. */
function definitionLabelEnd(line: Line): number {
  if (line.indent - line.baseIndent >= definitionIndent) return -1;
  if (line.next !== openBracket) return -1;
  if (line.text.charCodeAt(line.pos + 1) !== caret) return -1;
  const close = footnoteLabelEnd(
    line.text,
    line.pos + footnoteLabelOpen.length,
  );
  if (close < 0 || line.text.charCodeAt(close + 1) !== colon) return -1;
  return close;
}

/** Opens one footnote definition at the start of its line. */
function parseDefinition(cx: BlockContext, line: Line): boolean | null {
  const close = definitionLabelEnd(line);
  if (close < 0) return false;
  const from = cx.lineStart + line.pos;
  const labelFrom = from + footnoteLabelOpen.length;
  const labelTo = cx.lineStart + close;
  cx.startComposite(footnoteDefinitionNode, line.pos);
  cx.addElement(cx.elt(footnoteMarkNode, from, labelFrom));
  cx.addElement(cx.elt(footnoteLabelNode, labelFrom, labelTo));
  cx.addElement(cx.elt(footnoteMarkNode, labelTo, labelTo + 2));
  // The white space after the marker is part of it, so the text that
  // follows on the line never reads as indented code.
  line.moveBase(line.skipSpace(close + 2));
  return null;
}

/**
 * Whether a line continues an open definition, and moves past its indent.
 *
 * A blank line continues it, and so does a line indented four columns past
 * the container of the definition. Any other line ends it, unless it is a
 * lazy line of an open paragraph, which the parser keeps on its own.
 *
 * A blank line that the definition holds becomes a node of the definition,
 * so the range of the definition covers it, as the range of a quote covers
 * its quoted blank lines. A later parse reuses a block of an earlier one
 * only when the line after the block was read too (record 0155). The parser
 * keeps that rule for its own list items with a list of their types, and a
 * definition with a blank line at its end looked complete without it: a
 * parse that stopped on the blank line kept the definition without the
 * indented paragraph after it, which then read as code.
 */
function continuesDefinition(
  cx: BlockContext,
  line: Line,
  _value: number,
): boolean {
  if (line.next === -1) {
    line.addMarker(
      cx.elt(footnoteBlankNode, cx.lineStart, cx.lineStart + line.text.length),
    );
    return true;
  }
  if (line.indent < line.baseIndent + definitionIndent) return false;
  line.moveBaseColumn(line.baseIndent + definitionIndent);
  return true;
}

/** Reads one footnote reference at `pos`, or -1. */
function parseReference(cx: InlineContext, next: number, pos: number): number {
  if (next !== openBracket || cx.char(pos + 1) !== caret) return -1;
  const open = footnoteLabelOpen.length;
  const close = footnoteLabelEnd(cx.slice(pos, cx.end), open);
  if (close < 0) return -1;
  const end = pos + close + 1;
  return cx.addElement(
    cx.elt(footnoteReferenceNode, pos, end, [
      cx.elt(footnoteMarkNode, pos, pos + open),
      cx.elt(footnoteLabelNode, pos + open, end - 1),
      cx.elt(footnoteMarkNode, end - 1, end),
    ]),
  );
}

/**
 * The footnote extension of the live preview parser.
 *
 * Add it to `markdown({ extensions })` next to the GFM bundle. The definition
 * parser runs before the link reference, which would read `[^a]: b` as the
 * definition of a link, and the reference parser runs before the link, which
 * would read `[^a]` as a link without a target.
 */
export const footnoteMarkdownExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: footnoteDefinitionNode,
      block: true,
      composite: continuesDefinition,
    },
    { name: footnoteReferenceNode },
    { name: footnoteMarkNode, style: tags.processingInstruction },
    { name: footnoteLabelNode, style: tags.labelName },
    { name: footnoteBlankNode },
  ],
  parseBlock: [
    {
      name: footnoteDefinitionNode,
      parse: parseDefinition,
      before: 'LinkReference',
      endLeaf: (_cx, line) => definitionLabelEnd(line) >= 0,
    },
  ],
  parseInline: [
    { name: footnoteReferenceNode, parse: parseReference, before: 'Link' },
  ],
};
