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
 * Enter only opens a line inside it. A fence with no closer that already holds
 * a line of text stays as it is too, because the opener is then the opener of
 * code that a person wrote, as when they edit the language of a fence at the
 * end of a note, and a closer under it would turn that code into prose. That
 * keeps every existing document whole, including one where the new opener
 * takes the closer of a later block. The
 * new lines repeat the container of the opener: the quote marks stay, and a
 * list marker becomes the spaces of its width, so the block stays inside the
 * item or the quote.
 */
import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState, Line, TransactionSpec } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { openingDisplayMathFence } from '@notesapp/markdown';
import { mathBlockNode, mathMarkNode, mathTextNode } from './math-syntax.ts';

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

/** The text node of each fenced block node. */
const fenceTexts: Readonly<Record<string, string>> = {
  FencedCode: 'CodeText',
  [mathBlockNode]: mathTextNode,
};

/**
 * The quote marks and the list markers at the start of a line, which hold
 * the container of a block and not the block.
 */
const containerPrefix = /^(?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+))*/;

/** A code fence opener, whose backtick run takes no backtick after it. */
const codeOpener = /^ {0,3}(?:`{3,}[^`]*|~{3,}.*)$/;

/**
 * Whether the text of a line can open a fenced block, read from the text
 * alone, so that Enter on any other line parses nothing.
 */
function mayOpenFence(text: string): boolean {
  const body = text.slice(containerPrefix.exec(text)?.[0].length ?? 0);
  return codeOpener.test(body) || openingDisplayMathFence(body) !== null;
}

/** Whether a fenced block holds a line of text after its opener. */
function holdsText(state: EditorState, block: SyntaxNode): boolean {
  const name = fenceTexts[block.name] ?? '';
  return block
    .getChildren(name)
    .some((node) => state.doc.sliceString(node.from, node.to).trim() !== '');
}

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
  let prefix = state.doc.sliceString(line.from, markFrom);
  ensureSyntaxTree(state, line.to, parseBudget)?.iterate({
    from: line.from,
    to: markFrom,
    enter: (node) => {
      if (node.name !== 'ListMark' && node.name !== 'TaskMarker') return true;
      const from = node.from - line.from;
      const to = Math.min(node.to, markFrom) - line.from;
      if (from >= 0 && to > from)
        prefix = `${prefix.slice(0, from)}${' '.repeat(to - from)}${prefix.slice(to)}`;
      return false;
    },
  });
  return prefix;
}

/**
 * The transaction of Enter at the end of a line that opens a fenced block
 * with no closer, or null.
 *
 * The command declines for a selection that is not one caret, for a caret
 * that is not at the end of the line, for a line that opens nothing, for a
 * block that already has its closer, and for a block that already holds text.
 * The text of the line is read first, so Enter on a line that cannot open a
 * fence never parses the note.
 */
export function closeFenceSpec(state: EditorState): TransactionSpec | null {
  const range = state.selection.main;
  if (state.selection.ranges.length !== 1 || !range.empty) return null;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to || !mayOpenFence(line.text)) return null;
  const block = blockOpenedOn(state, line);
  if (block === null) return null;
  const markName = fenceMarks[block.name] ?? '';
  const marks = block.getChildren(markName);
  const opening = marks[0];
  if (opening === undefined || marks.length > 1) return null;
  if (holdsText(state, block)) return null;
  const prefix = continuationPrefix(state, line, opening.from);
  const closer = state.doc.sliceString(opening.from, opening.to);
  const insert = `\n${prefix}\n${prefix}${closer}`;
  return {
    changes: { from: line.to, insert },
    selection: { anchor: line.to + 1 + prefix.length },
  };
}
