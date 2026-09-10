/**
 * The note outline, read from the live Markdown tree.
 *
 * The outline panel used to hold a third definition of what a heading is,
 * which did not know about fenced code and disagreed with both the renderer
 * and the preview. It now reads the same syntax tree the preview reads, so a
 * `#` inside a code fence is code in every surface.
 *
 * This function is pure: it takes a state and returns rows. It never
 * dispatches, never focuses, and never touches the DOM. The caller moves the
 * cursor with the offsets it returns.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { contentText, headingLevel } from './live-preview.ts';

/** One heading row of the outline. */
export type OutlineHeading = {
  /** One to six. */
  readonly level: number;
  /** The heading text with its markers removed. */
  readonly text: string;
  /** The start of the heading in the document. */
  readonly from: number;
  /** The end of the heading in the document. */
  readonly to: number;
};

/**
 * Lists the headings of one document in order.
 *
 * ATX and setext headings both appear. A heading with no text is left out,
 * because an empty row cannot be read or activated.
 */
export function outlineOf(state: EditorState): readonly OutlineHeading[] {
  const found: OutlineHeading[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      const level = headingLevel(node.name);
      if (level === 0) return true;
      const text = contentText(state, node.from, node.to);
      if (text !== '')
        found.push({ level, text, from: node.from, to: node.to });
      return false;
    },
  });
  return found;
}
