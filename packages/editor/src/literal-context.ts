/**
 * Where the text of a note is literal (records 0172 and issue 259).
 *
 * Inside code, math, HTML, a link and an address, the characters of a note
 * mean what they are: a `[[` there is no wiki link, and a `/` there opens no
 * menu. The typed brackets and the paste of `completion.ts`, and the slash
 * menu of `slash-menu.ts`, read this one rule.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/** The nodes of the grammar whose text is literal. */
export const literalNodes: ReadonlySet<string> = new Set([
  'FencedCode',
  'CodeBlock',
  'InlineCode',
  'InlineMath',
  'MathBlock',
  'HTMLBlock',
  'HTMLTag',
  'CommentBlock',
  'Comment',
  'ProcessingInstruction',
  'ProcessingInstructionBlock',
  'Autolink',
  'URL',
  'Link',
  'Image',
  'Frontmatter',
]);

/**
 * Whether a position stands inside a literal node.
 *
 * The position is inside when the node starts before it and ends after it.
 * A block that runs to the end of the note, such as a fence with no closing
 * line, holds the end of the note as well.
 */
export function insideLiteral(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node !== null;
    node = node.parent
  ) {
    if (!literalNodes.has(node.name)) continue;
    if (
      node.from < pos &&
      (pos < node.to || (pos === node.to && pos === state.doc.length))
    )
      return true;
  }
  return false;
}
