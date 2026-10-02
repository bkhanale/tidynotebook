/**
 * Closes a fenced block that a person opens with Enter.
 *
 * A fence that is open runs to the end of its container, so a typed opener
 * made every line below it code, or a formula, until the person wrote the
 * closer too. Typora and Obsidian write the closer at once. Enter at the end
 * of a line that opens a code fence or a display math block therefore writes
 * an empty line, the closing fence under it, and puts the caret on the empty
 * line.
 *
 * The syntax tree decides, so the block is the block that both readers of the
 * note see: a fence that already has its closer below stays as it is, and
 * Enter only opens a line inside it. That keeps every existing document whole,
 * including one where the new opener takes the closer of a later block. The
 * new lines repeat the container of the opener: the quote marks stay, and a
 * list marker becomes the spaces of its width, so the block stays inside the
 * item or the quote.
 */
import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState, Line, TransactionSpec } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { mathBlockNode, mathMarkNode } from './math-syntax.ts';

/**
 * How long one Enter may parse the note to find the end of the block, in
 * milliseconds. The editor has parsed the note already in nearly every case,
 * so this is spent only on text the parser has not read yet. When it runs out
 * the command declines and Enter writes a plain new line.
 */
const parseBudget = 50;

/** The mark node of each fenced block node. */
const fenceMarks: Readonly<Record<string, string>> = {
  FencedCode: 'CodeMark',
  [mathBlockNode]: mathMarkNode,
};

/** The fenced block that starts on one line, or null. */
function blockOpenedOn(state: EditorState, line: Line): SyntaxNode | null {
  const tree = ensureSyntaxTree(state, state.doc.length, parseBudget);
  if (tree === null) return null;
  let found: SyntaxNode | null = null;
  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (found !== null) return false;
      if (fenceMarks[node.name] === undefined) return true;
      if (node.from >= line.from && node.from <= line.to) found = node.node;
      return false;
    },
  });
  return found;
}

/**
 * The prefix that a line inside the block repeats.
 *
 * The text before the opening mark holds the container of the block. A quote
 * mark stays, and a list marker or a task box becomes spaces of its width,
 * because a later line of an item is indented to its text.
 */
function continuationPrefix(
  state: EditorState,
  line: Line,
  markFrom: number,
): string {
  const characters = [...state.doc.sliceString(line.from, markFrom)];
  ensureSyntaxTree(state, line.to, parseBudget)?.iterate({
    from: line.from,
    to: markFrom,
    enter: (node) => {
      if (node.name !== 'ListMark' && node.name !== 'TaskMarker') return true;
      for (let at = node.from; at < Math.min(node.to, markFrom); at += 1)
        characters[at - line.from] = ' ';
      return false;
    },
  });
  return characters.join('');
}

/**
 * The transaction of Enter at the end of a line that opens a fenced block
 * with no closer, or null.
 *
 * The command declines for a selection that is not one caret, for a caret
 * that is not at the end of the line, for a line that opens nothing, and for
 * a block that already has its closer.
 */
export function closeFenceSpec(state: EditorState): TransactionSpec | null {
  const range = state.selection.main;
  if (state.selection.ranges.length !== 1 || !range.empty) return null;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to) return null;
  const block = blockOpenedOn(state, line);
  if (block === null) return null;
  const markName = fenceMarks[block.name] ?? '';
  const marks = block.getChildren(markName);
  const opening = marks[0];
  if (opening === undefined || marks.length > 1) return null;
  const prefix = continuationPrefix(state, line, opening.from);
  const closer = state.doc.sliceString(opening.from, opening.to);
  const insert = `\n${prefix}\n${prefix}${closer}`;
  return {
    changes: { from: line.to, insert },
    selection: { anchor: line.to + 1 + prefix.length },
  };
}
