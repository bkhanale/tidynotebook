/**
 * The guide as GitHub reads it.
 *
 * A guide page wraps its prose at 80 columns, and GitHub joins the lines of one
 * paragraph with a space, as CommonMark does. `renderMarkdown` renders a note,
 * and a note shows each new line as a line break (record 0107), so a wrapped
 * guide paragraph would break at every line of its source. The site therefore
 * joins each soft line break of the source before it renders. The parse is the
 * one parser of `packages/markdown`, so only a line ending inside the text of
 * a paragraph moves, with the quote markers of the next line: a hard break, a
 * code block, inline code and a table stay exactly as written.
 */
import { alertToneOf, parseMarkdown } from '@notesapp/markdown';
import type { Nodes } from 'mdast';

/**
 * A line ending inside text, with the indentation around it.
 *
 * Inside a quote each later line of a paragraph starts with the markers of
 * the quote, which belong to the quote and not to the text, so they go too.
 */
const softBreak = /[ \t]*\r?\n(?:[ \t]*>)*[ \t]*/g;

/**
 * Joins every soft line break of a Markdown source with one space.
 *
 * An alert marker such as `[!NOTE]` must stand on its own line, so the break
 * after the marker of a quote stays, and every later break of the quote joins.
 */
export function joinSoftBreaks(source: string): string {
  const ranges: { from: number; to: number }[] = [];
  const visit = (node: Nodes, alert: boolean): void => {
    if (node.type === 'text') {
      let from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from === undefined || to === undefined || !node.value.includes('\n'))
        return;
      if (alert && alertToneOf(node.value) !== null) {
        const end = source.indexOf('\n', from);
        if (end === -1 || end >= to) return;
        from = end + 1;
      }
      ranges.push({ from, to });
      return;
    }
    if (!('children' in node)) return;
    node.children.forEach((child, at) => {
      // The first text of the first paragraph of a quote is where a marker
      // can stand.
      const opens =
        at === 0 &&
        ((node.type === 'blockquote' && child.type === 'paragraph') ||
          (alert && node.type === 'paragraph'));
      visit(child, opens);
    });
  };
  visit(parseMarkdown(source), false);
  let result = source;
  for (const { from, to } of ranges.sort((a, b) => b.from - a.from))
    result = `${result.slice(0, from)}${result.slice(from, to).replace(softBreak, ' ')}${result.slice(to)}`;
  return result;
}
