/**
 * The plain text of a marked excerpt (record 0162).
 *
 * A search answer cuts an excerpt out of the Markdown of a note and marks the
 * words that matched. A reader of that excerpt wants the words of the note,
 * not its syntax, so this module turns the excerpt into the text a reader
 * sees. It parses the text with the one grammar of `./parse.ts`, so no second
 * parser decides what a mark of Markdown is.
 *
 * - Text, the label of a link, the text of an image, code and math stay.
 * - A link address, an image address, emphasis marks, the marks of a
 *   heading, a list, a quote and a table, raw HTML and front matter go.
 * - A line break, also a `<br>`, reads as one space, and a run of white space
 *   reads as one space.
 * - A block break stays visible, so a heading and the paragraph under it never
 *   read as one sentence. After the end of a sentence it is one space, and
 *   anywhere else it is ` · `.
 * - A first block that repeats the name of the note goes, when the caller
 *   names the note, because the excerpt is shown under that name. That is
 *   the first heading, and also the line that is left of it when the server
 *   cuts its headline after the `#` marks. It stays when nothing else is left.
 *
 * A marked word stays marked. The marks are ranges of the source, and each
 * character of the plain text keeps the source offset it came from. A value
 * that the parser changed, such as an escaped character, has no single
 * offset for each character, so its marked words are found in it by their
 * text instead.
 *
 * An excerpt is a window, and a construct that its edge cuts in half is no
 * construct to the grammar, so its marks stay as text. A text that the
 * grammar refuses, by its size or its depth, comes back as it was.
 */
import type { Nodes } from 'mdast';
import { toString } from 'mdast-util-to-string';
import { MarkdownLimitError } from './limits.ts';
import { parseMarkdown } from './parse.ts';

/** One part of an excerpt. A marked part is a word that the query matched. */
export type ExcerptText = {
  readonly text: string;
  readonly marked: boolean;
};

/** One character of the plain text and whether it is part of a match. */
type PlainCharacter = { readonly char: string; readonly marked: boolean };

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
  'html',
  'yaml',
  'definition',
  'footnoteReference',
  'thematicBreak',
]);

/** The separator between two blocks of an excerpt. */
export const blockSeparator = ' · ';

/** A character that ends a sentence, after which a space separates blocks. */
const sentenceEnd = /[.!?:;\u2026]/;

/** A name as a heading and a note name are compared. */
function comparable(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

/** Builds the plain characters of one source with its marked ranges. */
function plainCharacters(
  source: string,
  ranges: readonly (readonly [number, number])[],
  tree: Nodes,
  skip: Nodes | null,
): readonly PlainCharacter[] {
  // The parser removes a leading byte order mark before it assigns offsets.
  const shift = source.startsWith('﻿') ? 1 : 0;
  const terms = ranges
    .map(([from, to]) => source.slice(from, to))
    .filter((term) => term.trim() !== '');
  const output: PlainCharacter[] = [];
  // A block ended, and the next character of text starts the next block.
  let blockEnded = false;

  const isMarked = (offset: number): boolean =>
    ranges.some(([from, to]) => offset >= from && offset < to);

  const push = (char: string, marked: boolean): void => {
    if (/\s/.test(char)) {
      if (output.length === 0 || output.at(-1)?.char === ' ') return;
      output.push({ char: ' ', marked: false });
      return;
    }
    if (blockEnded && output.length > 0) {
      while (output.at(-1)?.char === ' ') output.pop();
      const separator = sentenceEnd.test(output.at(-1)?.char ?? '')
        ? ' '
        : blockSeparator;
      for (const part of separator) output.push({ char: part, marked: false });
    }
    blockEnded = false;
    output.push({ char, marked });
  };

  const space = (): void => {
    push(' ', false);
  };

  // A value of one node, mapped back to its offsets in the source.
  const value = (text: string, node: Nodes): void => {
    if (text === '') return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      const slice = source.slice(start + shift, end + shift);
      const at = slice === text ? 0 : slice.indexOf(text);
      if (at >= 0) {
        const base = start + shift + at;
        for (let index = 0; index < text.length; index += 1)
          push(text.charAt(index), isMarked(base + index));
        return;
      }
    }
    // The parser changed the value, so its marked words are found by text.
    const marked = new Array<boolean>(text.length).fill(false);
    for (const term of terms) {
      let found = text.indexOf(term);
      while (found >= 0) {
        marked.fill(true, found, found + term.length);
        found = text.indexOf(term, found + term.length);
      }
    }
    for (let index = 0; index < text.length; index += 1)
      push(text.charAt(index), marked[index] ?? false);
  };

  const walk = (node: Nodes): void => {
    if (node === skip) return;
    // A line break written in HTML is a line break.
    if (node.type === 'html' && /^<br\s*\/?>$/i.test(node.value)) space();
    if (hiddenTypes.has(node.type)) return;
    if (
      node.type === 'text' ||
      node.type === 'inlineCode' ||
      node.type === 'code' ||
      node.type === 'math' ||
      node.type === 'inlineMath'
    )
      value(node.value, node);
    else if (node.type === 'image' || node.type === 'imageReference')
      value(node.alt ?? '', node);
    else if (node.type === 'break') space();
    else if ('children' in node) for (const child of node.children) walk(child);
    if (blockTypes.has(node.type)) blockEnded = true;
  };

  walk(tree);
  while (output.at(-1)?.char === ' ') output.pop();
  return output;
}

/** The first block of a tree when it repeats the name of the note. */
function repeatedTitle(tree: Nodes, title: string | undefined): Nodes | null {
  if (title === undefined || !('children' in tree)) return null;
  const first = tree.children.find((child) => !hiddenTypes.has(child.type));
  if (first === undefined) return null;
  if (first.type !== 'heading' && first.type !== 'paragraph') return null;
  return comparable(toString(first)) === comparable(title) ? first : null;
}

/**
 * The text a reader sees in one marked excerpt of Markdown.
 *
 * The parts come back in reading order, with the matched words marked and
 * every neighbour of one kind joined into one part. `title` is the name of
 * the note that the excerpt is shown under, without its `.md` suffix.
 */
export function plainExcerpt(
  parts: readonly ExcerptText[],
  options: { readonly title?: string | undefined } = {},
): readonly ExcerptText[] {
  let source = '';
  const ranges: [number, number][] = [];
  for (const part of parts) {
    if (part.marked)
      ranges.push([source.length, source.length + part.text.length]);
    source += part.text;
  }
  let tree: Nodes;
  try {
    tree = parseMarkdown(source);
  } catch (failure) {
    if (failure instanceof MarkdownLimitError) return parts;
    throw failure;
  }
  const skip = repeatedTitle(tree, options.title);
  const shown = plainCharacters(source, ranges, tree, skip);
  const characters =
    skip !== null && shown.length === 0
      ? plainCharacters(source, ranges, tree, null)
      : shown;
  const result: { text: string; marked: boolean }[] = [];
  for (const { char, marked } of characters) {
    const last = result.at(-1);
    if (last !== undefined && last.marked === marked) last.text += char;
    else result.push({ text: char, marked });
  }
  return result;
}
