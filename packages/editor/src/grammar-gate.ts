/**
 * The Markdown language of the editor, kept only for a note that the one
 * grammar reads (record 0182).
 *
 * A note over a limit of `@notesapp/markdown` is a note that the renderer
 * refuses and that a reader sees as its source. The Lezer parser of the
 * editor met the same notes: a long run of inline marks in one paragraph ran
 * it out of stack and froze the tab. The editor therefore shows such a note
 * as plain text, as a reader shows it, and every layer that reads the
 * syntax tree (the live preview, the widgets, the table grid, the outline)
 * reads an empty tree and draws nothing.
 *
 * The answer follows the note. A new state asks `withinParseLimits`. Each
 * change reads the lines of the new document with `lineLimits`, which copies
 * nothing, and that answer stands when it is sure. It is unsure when a part of
 * the note between blank lines holds more marks than one block may, and only
 * the parse of the blocks can tell. Then the editor copies the note and asks
 * `withinParseLimits` when the change inserts much text, which a paste does,
 * or while the note shows as plain text, so that its formatting comes back
 * as soon as the note is within the limits again. A small change to a note
 * with its formatting keeps it, because it adds a few marks to a block that
 * the parser reads quickly, and the next open or paste checks the whole note.
 */
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import { lineLimits, withinParseLimits } from '@notesapp/markdown';

/**
 * The text that one change inserts before the editor checks the whole note
 * at once. A paste of a block of marks reaches it, and a key does not.
 */
export const checkedInsertLength = 4096;

/** The compartment that holds the Markdown language, or nothing. */
const grammarCompartment = new Compartment();

/** Sets whether the note is within the limits of the grammar. */
const setWithinLimits = StateEffect.define<boolean>();

/** Whether the note is within the limits, so the language reads it. */
const withinLimitsField = StateField.define<boolean>({
  create: (state) => withinParseLimits(state.doc.toString()),
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setWithinLimits)) return effect.value;
    return value;
  },
});

/** How much text a transaction inserts. */
function insertedLength(transaction: Transaction): number {
  let length = 0;
  transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    length += inserted.length;
  });
  return length;
}

/** Whether the document after `transaction` is within the limits. */
function withinAfter(transaction: Transaction, before: boolean): boolean {
  const lines = lineLimits(transaction.newDoc.iterLines());
  if (lines !== 'unsure') return lines === 'within';
  if (before && insertedLength(transaction) < checkedInsertLength) return true;
  return withinParseLimits(transaction.newDoc.toString());
}

/** Whether the Markdown language reads the note of a state. */
export function markdownGrammarOn(state: EditorState): boolean {
  return state.field(withinLimitsField, false) ?? true;
}

/**
 * The Markdown language `markdown`, on while the note is within the limits
 * of the one grammar and off while it is not.
 *
 * `within` is the answer for the first document, which the caller reads
 * before it builds the state, because the compartment takes its first
 * content then.
 */
export function gatedMarkdown(markdown: Extension, within: boolean): Extension {
  return [
    withinLimitsField.init(() => within),
    grammarCompartment.of(within ? markdown : []),
    EditorState.transactionExtender.of((transaction) => {
      if (!transaction.docChanged) return null;
      const before = transaction.startState.field(withinLimitsField);
      const after = withinAfter(transaction, before);
      if (after === before) return null;
      return {
        effects: [
          setWithinLimits.of(after),
          grammarCompartment.reconfigure(after ? markdown : []),
        ],
      };
    }),
  ];
}
