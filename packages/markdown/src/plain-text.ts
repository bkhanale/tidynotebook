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
 * - A block break and a line break, also a `<br>`, read as one space, and a
 *   run of white space reads as one space.
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
import { MarkdownLimitError } from './limits.ts';
import { parseMarkdown } from './parse.ts';

/** One part of an excerpt. A marked part is a word that the query matched. */
export type ExcerptText = {
  readonly text: string;
  readonly marked: boolean;
};

/** One character of the plain text and whether it is part of a match. */
type PlainCharacter = { readonly char: string; readonly marked: boolean };

/** The nodes that end a block, so a space separates them from the next. */
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

/** Builds the plain characters of one source with its marked ranges. */
function plainCharacters(
  source: string,
  ranges: readonly (readonly [number, number])[],
  tree: Nodes,
): readonly PlainCharacter[] {
  // The parser removes a leading byte order mark before it assigns offsets.
  const shift = source.startsWith('﻿') ? 1 : 0;
  const terms = ranges
    .map(([from, to]) => source.slice(from, to))
    .filter((term) => term.trim() !== '');
  const output: PlainCharacter[] = [];

  const isMarked = (offset: number): boolean =>
    ranges.some(([from, to]) => offset >= from && offset < to);

  const push = (char: string, marked: boolean): void => {
    if (/\s/.test(char)) {
      if (output.length === 0 || output.at(-1)?.char === ' ') return;
      output.push({ char: ' ', marked: false });
      return;
    }
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
    if (blockTypes.has(node.type)) space();
  };

  walk(tree);
  while (output.at(-1)?.char === ' ') output.pop();
  return output;
}

/**
 * The text a reader sees in one marked excerpt of Markdown.
 *
 * The parts come back in reading order, with the matched words marked and
 * every neighbour of one kind joined into one part.
 */
export function plainExcerpt(
  parts: readonly ExcerptText[],
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
  const result: { text: string; marked: boolean }[] = [];
  for (const { char, marked } of plainCharacters(source, ranges, tree)) {
    const last = result.at(-1);
    if (last !== undefined && last.marked === marked) last.text += char;
    else result.push({ text: char, marked });
  }
  return result;
}
