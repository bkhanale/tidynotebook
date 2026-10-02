/**
 * The readable text of a note: the words a reader sees, with no Markdown.
 *
 * Search matches and quotes this text (record 0167), so a result shows what
 * the note says and not how it is written. The text comes from the one tree
 * of `./parse.ts`, so it never disagrees with the renderer about what is a
 * mark and what is a word.
 *
 * - A mark of emphasis, a heading, a list, a quote or a table leaves its words
 *   and drops its signs.
 * - A link leaves its label and drops its address. A picture leaves its
 *   alternative text, which is the text a reader gets in its place.
 * - Code and math keep their source, because that is what a reader reads.
 * - Raw HTML, front matter, a link definition and a footnote reference are
 *   not shown to a reader, so they leave nothing.
 * - An alert leaves its title, as the renderer writes it, in place of its
 *   marker.
 *
 * A block ends with a line break, and the cells of a table row are joined by
 * a space, so two words of two blocks never run together.
 */
import type { Nodes, Root } from 'mdast';
import { alertMarkerLength, alertTitle, alertToneOf } from './alerts.ts';
import { parseMarkdown } from './parse.ts';

/** The text of an inline node and of everything inside it. */
function inlineText(node: Nodes): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'inlineMath':
      return node.value;
    case 'image':
    case 'imageReference':
      return node.alt ?? '';
    case 'break':
      return '\n';
    case 'html':
    case 'footnoteReference':
      return '';
    default:
      return 'children' in node
        ? node.children.map((child) => inlineText(child)).join('')
        : '';
  }
}

/** The text of a list of block nodes, one line break after each block. */
function blocksText(nodes: readonly Nodes[]): string {
  return nodes.map((node) => blockText(node)).join('');
}

/** The text of one block node, ending with a line break when it has text. */
function blockText(node: Nodes): string {
  switch (node.type) {
    case 'yaml':
    case 'html':
    case 'definition':
    case 'thematicBreak':
      return '';
    case 'code':
    case 'math':
      return node.value === '' ? '' : `${node.value}\n`;
    case 'paragraph':
    case 'heading': {
      const text = inlineText(node);
      return text === '' ? '' : `${text}\n`;
    }
    case 'table':
      return node.children
        .map(
          (row) =>
            `${row.children.map((cell) => inlineText(cell)).join(' ')}\n`,
        )
        .join('');
    case 'blockquote': {
      const text = blocksText(node.children);
      const tone = alertToneOf(text);
      return tone === null
        ? text
        : `${alertTitle(tone)}\n${text.slice(alertMarkerLength(text))}`;
    }
    default:
      return 'children' in node
        ? blocksText(node.children)
        : `${inlineText(node)}\n`;
  }
}

/** The readable text of a parsed tree. */
export function readableTextOf(tree: Root): string {
  return blocksText(tree.children).trimEnd();
}

/**
 * The readable text of one note.
 *
 * It refuses a note over the limits of `./limits.ts` with
 * `MarkdownLimitError`, as every entry point of this package does.
 */
export function readableText(source: string): string {
  return readableTextOf(parseMarkdown(source));
}
