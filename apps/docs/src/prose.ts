/**
 * The guide as GitHub reads it.
 *
 * A guide page wraps its prose at 80 columns, and GitHub joins the lines of one
 * paragraph with a space, as CommonMark does. `renderMarkdown` renders a note,
 * and a note shows each new line as a line break (record 0107), so a wrapped
 * guide paragraph would break at every line of its source. The site therefore
 * joins each soft line break of the source before it renders. The parse is the
 * one parser of `packages/markdown`, so only a line ending inside the text of
 * a paragraph moves: a hard break, a code block, inline code and a table stay
 * exactly as written.
 */
import { parseMarkdown } from '@notesapp/markdown';
import type { Nodes } from 'mdast';

/** A line ending inside text, with the indentation around it. */
const softBreak = /[ \t]*\r?\n[ \t]*/g;

/** Joins every soft line break of a Markdown source with one space. */
export function joinSoftBreaks(source: string): string {
  const ranges: { from: number; to: number }[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === 'text') {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from !== undefined && to !== undefined && node.value.includes('\n'))
        ranges.push({ from, to });
      return;
    }
    if ('children' in node) for (const child of node.children) visit(child);
  };
  visit(parseMarkdown(source));
  let result = source;
  for (const { from, to } of ranges.sort((a, b) => b.from - a.from))
    result = `${result.slice(0, from)}${result.slice(from, to).replace(softBreak, ' ')}${result.slice(to)}`;
  return result;
}
