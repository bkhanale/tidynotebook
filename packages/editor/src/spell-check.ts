/**
 * The spell check of a note, by the browser (record 0103).
 *
 * CodeMirror turns the spell checker of the browser off on its content
 * element. This module turns it on for the note editor and keeps it off for
 * the text that is not prose: code, an address, HTML, front matter and math.
 * A word there is not a word of a language, so a mark on it is noise that
 * hides the marks that matter.
 *
 * The browser owns the rest: the languages of the device, the personal
 * dictionary, the marks and the menu of suggestions. A correction from that
 * menu reaches CodeMirror as input, so it is one transaction like typing.
 *
 * Cost. The ranges come from the Lezer tree of `./language.ts`, never from a
 * scan of the text (record 0001), and only the visible ranges are walked, as
 * the live preview does.
 */
import { syntaxTree } from '@codemirror/language';
import {
  Prec,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { PreviewRange } from './live-preview.ts';
import { inlineMathNode, mathBlockNode } from './math-syntax.ts';

/**
 * The nodes whose text the spell check skips, with everything inside them.
 *
 * The text of a link, the alternative text of an image, a heading, a table
 * cell and a list item are prose and stay in the check. A new kind of code
 * syntax joins this list.
 */
export const unspelledNodes: ReadonlySet<string> = new Set([
  'Frontmatter',
  'InlineCode',
  'FencedCode',
  'CodeBlock',
  'URL',
  'Autolink',
  'LinkLabel',
  'HTMLBlock',
  'HTMLTag',
  'Comment',
  'CommentBlock',
  'ProcessingInstruction',
  'ProcessingInstructionBlock',
  'Entity',
  mathBlockNode,
  inlineMathNode,
]);

/**
 * The ranges of the visible text that the spell check skips, in order.
 *
 * A node that crosses the edge of two visible ranges is reported once, so the
 * ranges never overlap.
 */
export function unspelledRanges(
  state: EditorState,
  visible: readonly PreviewRange[],
): readonly PreviewRange[] {
  const found: PreviewRange[] = [];
  const tree = syntaxTree(state);
  for (const range of visible) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        if (!unspelledNodes.has(node.name)) return true;
        const last = found.at(-1);
        if (last === undefined || node.from >= last.to)
          found.push({ from: node.from, to: node.to });
        return false;
      },
    });
  }
  return found;
}

/** The mark that keeps one range out of the check of the browser. */
const unspelled = Decoration.mark({ attributes: { spellcheck: 'false' } });

function unspelledDecorations(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  for (const range of unspelledRanges(view.state, view.visibleRanges)) {
    if (range.to > range.from)
      marks.push(unspelled.range(range.from, range.to));
  }
  return Decoration.set(marks);
}

/** Keeps the marks of the visible ranges current. */
export const unspelledMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = unspelledDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = unspelledDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

/**
 * The spell check, on or off.
 *
 * Off adds nothing, so the default of CodeMirror, `spellcheck="false"`,
 * stays in force. On states `spellcheck="true"` on the content element, which
 * outranks that default, and marks the ranges that stay out of the check.
 */
export function spellCheck(enabled: boolean): Extension {
  if (!enabled) return [];
  // The highest precedence draws the mark inside every other mark. A mark
  // outside would split the element of a construct that spans more text, for
  // example the body cell of a list item, into two elements.
  return [
    EditorView.contentAttributes.of({ spellcheck: 'true' }),
    Prec.highest(unspelledMarks),
  ];
}
