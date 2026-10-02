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
 * Enter only opens a line inside it.
 *
 * A fence with no closer that already holds text is the hard case, because
 * the tree cannot tell its two histories apart. When the person has just
 * typed the fence marks above text they wrote before, the text is not code,
 * and Enter writes the closer under the new caret line, so the text stays
 * outside the fence. When the line opened the fence before the person came
 * to it, as when they edit the language of a fence of code at the end of a
 * note, the text is code, and a closer under the opener would turn it into
 * prose. `typedFenceOpeners` keeps the openers that the person typed, so
 * Enter knows which history a line has. A paste is not typing, so a pasted
 * opener is not one of them. That keeps every existing document whole,
 * including one where the new opener takes the closer of a later block. The
 * new lines repeat the container of the opener: the quote marks stay, and a
 * list marker becomes the spaces of its width, so the block stays inside the
 * item or the quote.
 */
import { ensureSyntaxTree } from '@codemirror/language';
import {
  StateField,
  type EditorState,
  type Line,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
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

/**
 * The openers that the person typed, by the start of their line.
 *
 * A typing transaction that turns the line of the caret from a line that
 * opens no fence into one that can open a fence records that line. The
 * record follows later changes, and it goes when the line stops being an
 * opener or the caret leaves the line, so it never outlives the moment of
 * writing the fence.
 */
export const typedFenceOpeners = StateField.define<readonly number[]>({
  create: () => [],
  update: (openers, transaction) => typedOpenersAfter(openers, transaction),
});

/** The typed openers after one transaction. */
function typedOpenersAfter(
  openers: readonly number[],
  transaction: Transaction,
): readonly number[] {
  const { state, startState, changes } = transaction;
  const caretLine = state.doc.lineAt(state.selection.main.head).from;
  const kept = openers
    .map((from) => changes.mapPos(from, -1))
    .filter(
      (from) => from === caretLine && mayOpenFence(state.doc.lineAt(from).text),
    );
  if (
    !transaction.docChanged ||
    !transaction.isUserEvent('input.type') ||
    kept.includes(caretLine)
  )
    return kept;
  const line = state.doc.lineAt(caretLine);
  if (!mayOpenFence(line.text)) return kept;
  const before = startState.doc.lineAt(
    changes.invertedDesc.mapPos(line.from, -1),
  );
  if (mayOpenFence(before.text)) return kept;
  return [...kept, line.from];
}

/** Whether the person typed the opener on the line that starts at `from`. */
function typedOpenerAt(state: EditorState, from: number): boolean {
  return state.field(typedFenceOpeners, false)?.includes(from) === true;
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
 * block that already has its closer, and for a block that already holds text
 * when the person did not type its opener.
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
  // A fence that holds text is code that the person wrote, unless they have
  // just typed its opener above that text.
  if (holdsText(state, block) && !typedOpenerAt(state, line.from)) return null;
  const prefix = continuationPrefix(state, line, opening.from);
  const closer = state.doc.sliceString(opening.from, opening.to);
  const insert = `\n${prefix}\n${prefix}${closer}`;
  return {
    changes: { from: line.to, insert },
    selection: { anchor: line.to + 1 + prefix.length },
  };
}
