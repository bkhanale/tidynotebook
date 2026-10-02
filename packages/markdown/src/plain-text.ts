/**
 * The readable text of a note: the words a reader sees, with no Markdown.
 *
 * This is the one plain text rule of Markdown. The server search index holds
 * this text (record 0167), so its headline is plain text already, and the
 * device search reads the same text of its Markdown (record 0162). Both
 * excerpts are therefore cut from one text. It parses with the one grammar of
 * `./parse.ts`, so no second parser decides what a mark of Markdown is.
 *
 * - Text, the label of a link, the text of an image, code and math stay.
 * - A link address, an image address, emphasis marks, the marks of a
 *   heading, a list, a quote and a table, front matter, a link definition and
 *   a footnote mark go. A bare address is text, so it stays.
 * - HTML that the author wrote keeps the text that a reader sees, by the rule
 *   of record 0157 in `./html-elements.ts`: every element keeps the words
 *   between its tags, and an element of `authorStrippedElements` leaves with
 *   them. The tags go, and a block element such as `<details>` ends a block.
 * - An alert leaves its title, as the renderer writes it, in place of its
 *   marker.
 * - A line break, also a `<br>`, reads as one space, and a run of white space
 *   reads as one space.
 * - A block break stays visible, so a heading and the paragraph under it never
 *   read as one sentence. After the end of a sentence it is one space, and
 *   anywhere else it is `blockSeparator`.
 * - A first block that repeats the name of the note goes, when the caller
 *   names the note, because an excerpt is shown under that name. It stays
 *   when nothing else is left.
 */
import type { Nodes as HastNodes, Root as HastRoot } from 'hast';
import { raw } from 'hast-util-raw';
import type { Nodes, Root } from 'mdast';
import { toString } from 'mdast-util-to-string';
import { alertMarkerLength, alertTitle, alertToneOf } from './alerts.ts';
import { authorStrippedElements } from './html-elements.ts';
import { parseMarkdown } from './parse.ts';

/** The separator between two blocks that a sentence end does not part. */
export const blockSeparator = ' · ';

/** What the caller knows of the note. */
export type ReadableTextOptions = {
  /** The name of the note, without its `.md` suffix. */
  readonly title?: string | undefined;
};

/** The nodes that end a block, so a separator stands before the next. */
const blockTypes = new Set<string>([
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'code',
  'math',
  'table',
  'tableRow',
  'tableCell',
  'footnoteDefinition',
]);

/** The nodes that a reader never sees in the text of a note. */
const hiddenTypes = new Set<string>([
  'yaml',
  'definition',
  'footnoteReference',
  'thematicBreak',
]);

/**
 * The HTML elements that stand as a block of their own, so their words never
 * run into the words around them. This is layout, not permission: which
 * elements a note keeps is the list of `./html-elements.ts`.
 */
const htmlBlockElements = new Set<string>([
  'address',
  'blockquote',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

/**
 * The words of one piece of author HTML, as parts with the blocks that end.
 *
 * parse5, through `hast-util-raw`, reads the piece as a browser does, so a tag
 * never reads as text and an entity reads as its character.
 */
function htmlParts(html: string): readonly (string | null)[] {
  const tree: HastRoot = {
    type: 'root',
    children: [{ type: 'raw', value: html }],
  };
  const parsed = raw(tree);
  const parts: (string | null)[] = [];
  const walk = (node: HastNodes): void => {
    if (node.type === 'text') {
      parts.push(node.value);
      return;
    }
    if (node.type === 'element') {
      if (authorStrippedElements.includes(node.tagName)) return;
      if (node.tagName === 'br') {
        parts.push(' ');
        return;
      }
      for (const child of node.children) walk(child);
      if (htmlBlockElements.has(node.tagName)) parts.push(null);
      return;
    }
    if (node.type === 'root') for (const child of node.children) walk(child);
  };
  walk(parsed);
  return parts;
}

/** A character that ends a sentence, after which a space separates blocks. */
const sentenceEnd = /[.!?:;…]$/;

/** A name as a heading and a note name are compared. */
function comparable(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

/** The first block of a tree when it repeats the name of the note. */
function repeatedTitle(tree: Root, title: string | undefined): Nodes | null {
  if (title === undefined) return null;
  const first = tree.children.find((child) => !hiddenTypes.has(child.type));
  if (first === undefined) return null;
  if (first.type !== 'heading' && first.type !== 'paragraph') return null;
  return comparable(toString(first)) === comparable(title) ? first : null;
}

/** The readable text of a tree, leaving out the node `skip`. */
function textOf(tree: Root, skip: Nodes | null): string {
  let output = '';
  // A block ended, and the next character of text starts the next block.
  let blockEnded = false;
  // The first text of a quote can be the marker of an alert.
  let quoteOpened = false;

  const push = (text: string): void => {
    for (const char of text) {
      if (/\s/.test(char)) {
        if (output !== '' && !output.endsWith(' ')) output += ' ';
        continue;
      }
      if (blockEnded && output !== '') {
        output = output.trimEnd();
        output += sentenceEnd.test(output) ? ' ' : blockSeparator;
      }
      blockEnded = false;
      output += char;
    }
  };

  const walk = (node: Nodes): void => {
    if (node === skip) return;
    if (node.type === 'html') {
      // A null part is the end of a block element of the piece.
      for (const part of htmlParts(node.value))
        if (part === null) blockEnded = true;
        else push(part);
      return;
    }
    if (hiddenTypes.has(node.type)) return;
    if (node.type === 'text' && quoteOpened) {
      quoteOpened = false;
      const tone = alertToneOf(node.value);
      if (tone !== null) {
        push(alertTitle(tone));
        blockEnded = true;
        push(node.value.slice(alertMarkerLength(node.value)));
        return;
      }
    }
    if (
      node.type === 'text' ||
      node.type === 'inlineCode' ||
      node.type === 'code' ||
      node.type === 'math' ||
      node.type === 'inlineMath'
    )
      push(node.value);
    else if (node.type === 'image' || node.type === 'imageReference')
      push(node.alt ?? '');
    else if (node.type === 'break') push(' ');
    else if ('children' in node) {
      if (node.type === 'blockquote') quoteOpened = true;
      for (const child of node.children) walk(child);
    }
    if (node.type === 'blockquote') quoteOpened = false;
    if (blockTypes.has(node.type)) blockEnded = true;
  };

  walk(tree);
  return output.trimEnd();
}

/** The readable text of a parsed tree. */
export function readableTextOf(
  tree: Root,
  options: ReadableTextOptions = {},
): string {
  const skip = repeatedTitle(tree, options.title);
  const shown = textOf(tree, skip);
  return skip !== null && shown === '' ? textOf(tree, null) : shown;
}

/**
 * The readable text of one note.
 *
 * It refuses a note over the limits of `./limits.ts` with
 * `MarkdownLimitError`, as every entry point of this package does.
 */
export function readableText(
  source: string,
  options: ReadableTextOptions = {},
): string {
  return readableTextOf(parseMarkdown(source), options);
}
