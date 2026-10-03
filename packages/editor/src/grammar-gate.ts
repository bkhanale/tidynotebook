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
 * The answer follows the note, and a key reads only the parts of the note
 * that it touches. A new state asks `withinParseLimits`, and reads every line
 * once (`measureNote`). Each change then updates that reading from the parts
 * around it (`measureAfter` in `./note-measure.ts`), and the answer stands
 * when it is sure. It is unsure when a part of the note between blank lines
 * holds more marks than one block may, and only the parse of the blocks can
 * tell. Then a change keeps the answer of the last whole check while two
 * things hold, and the editor copies the note and asks `withinParseLimits`
 * as soon as one fails:
 *
 * - The changes since that check insert less than `checkedInsertLength`
 *   characters in all. A paste reaches it at once, and changes that come in
 *   pieces, as the work of another device does, reach it together.
 * - No part holds more marks than `vouchedPartMarks`. Below it, no block of
 *   the part runs the Lezer parser out of stack, however a small change
 *   elsewhere ends or joins the blocks of the part.
 *
 * A note that shows as plain text is asked again after a pause in typing, so
 * that its formatting comes back once the note is within the limits again,
 * and no key copies the whole note.
 */
import {
  Compartment,
  EditorState,
  type ChangeSet,
  type Text,
  Facet,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import {
  limitsOfMeasure,
  measureParts,
  withinParseLimits,
  type PartsMeasure,
} from '@notesapp/markdown';
import { measureAfter, measureNote, type ReadParts } from './note-measure.ts';

/**
 * The text that changes insert, while the reading of the lines is unsure,
 * before the editor checks the whole note again. A paste of a block of marks
 * reaches it at once, and a key does not.
 */
export const checkedInsertLength = 4096;

/**
 * The pause in typing after which a note that shows as plain text is asked
 * again whether the grammar reads it.
 */
export const plainRecheckMs = 1000;

/**
 * The checks that the gate runs. The editor uses those of
 * `@notesapp/markdown`, and a test passes checks that count their work.
 */
export type GateChecks = {
  /** Reads a run of lines of the note, as `measureParts` does. */
  readonly read: ReadParts;
  /** Checks the whole note, as `withinParseLimits` does. */
  readonly whole: (source: string) => boolean;
};

/** The checks of `@notesapp/markdown`. */
const markdownChecks: GateChecks = {
  read: measureParts,
  whole: withinParseLimits,
};

/** The language that the gate turns on and off, and its checks. */
const gateConfig = Facet.define<
  { readonly markdown: Extension; readonly checks: GateChecks },
  { readonly markdown: Extension; readonly checks: GateChecks } | null
>({ combine: (values) => values[0] ?? null });

/** The compartment that holds the Markdown language, or nothing. */
const grammarCompartment = new Compartment();

/** What the gate knows of the note. */
type GateValue = {
  /** Whether the note is within the limits, so the language reads it. */
  readonly within: boolean;
  /** The reading of the lines of the note. */
  readonly measure: PartsMeasure;
  /**
   * The characters that changes inserted since the answer was last sure:
   * since a whole check, or since the reading of the lines last decided.
   */
  readonly unchecked: number;
};

/**
 * Sets the answer of a whole check: whether the note is within the limits,
 * so the language reads it.
 */
const setWithinLimits = StateEffect.define<boolean>();

/**
 * The reading after each change, kept for the one change it was made for.
 *
 * The extender of the gate reads the parts around a change to decide, and
 * the field keeps the reading. A change is read once: whichever of the two
 * meets it first leaves the reading here for the other. The key is the
 * changes, and the document before them must match.
 */
const readings = new WeakMap<
  ChangeSet,
  { readonly before: Text; readonly measure: PartsMeasure }
>();

/** The reading of the note after `transaction`, from the one before it. */
function measureOf(
  transaction: Transaction,
  measure: PartsMeasure,
): PartsMeasure {
  const before = transaction.startState.doc;
  const known = readings.get(transaction.changes);
  if (known !== undefined && known.before === before) return known.measure;
  const after = measureAfter(
    measure,
    before,
    transaction.changes,
    transaction.newDoc,
    transaction.startState.facet(gateConfig)?.checks.read,
  );
  readings.set(transaction.changes, { before, measure: after });
  return after;
}

/** How much text a transaction inserts. */
function insertedLength(transaction: Transaction): number {
  let length = 0;
  transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    length += inserted.length;
  });
  return length;
}

/**
 * What the gate knows after `transaction`, from what it knew before it.
 *
 * A sure reading of the lines decides. An unsure one keeps the answer of the
 * last whole check while the text inserted since then stays below
 * `checkedInsertLength` and no part is crowded. A note that shows as plain
 * text needs no whole check for a crowded part, because no parser reads it.
 */
function gateAfter(
  transaction: Transaction,
  before: GateValue,
  checks: GateChecks,
): GateValue {
  const measure = measureOf(transaction, before.measure);
  const lines = limitsOfMeasure(measure);
  if (lines !== 'unsure')
    return { within: lines === 'within', measure, unchecked: 0 };
  const unchecked = before.unchecked + insertedLength(transaction);
  const crowded = before.within && measure.crowdedParts > 0;
  if (unchecked < checkedInsertLength && !crowded)
    return { within: before.within, measure, unchecked };
  return {
    within: checks.whole(transaction.newDoc.toString()),
    measure,
    unchecked: 0,
  };
}

/**
 * The value of the gate after each change, kept for the one change it was
 * made for, as `readings` keeps the reading. The extender of the gate and its
 * field both need it, and a whole check runs once.
 */
const answers = new WeakMap<
  ChangeSet,
  { readonly before: GateValue; readonly after: GateValue }
>();

/** The value of the gate after `transaction`, decided once. */
function answerOf(transaction: Transaction, before: GateValue): GateValue {
  const known = answers.get(transaction.changes);
  if (known !== undefined && known.before === before) return known.after;
  const checks =
    transaction.startState.facet(gateConfig)?.checks ?? markdownChecks;
  const after = gateAfter(transaction, before, checks);
  answers.set(transaction.changes, { before, after });
  return after;
}

/** What the gate knows of the note of a state. */
const gateField = StateField.define<GateValue>({
  create: (state) => ({
    within: withinParseLimits(state.doc.toString()),
    measure: measureNote(state.doc),
    unchecked: 0,
  }),
  update(value, transaction) {
    // A transaction filter can read the state of a change before the gate
    // extends it, as the list numbering does, so the field decides the
    // change itself, and the extender reads the same answer.
    let next = transaction.docChanged ? answerOf(transaction, value) : value;
    for (const effect of transaction.effects)
      if (effect.is(setWithinLimits) && effect.value !== next.within)
        next = { ...next, within: effect.value, unchecked: 0 };
    return next.within === value.within &&
      next.measure === value.measure &&
      next.unchecked === value.unchecked
      ? value
      : next;
  },
});

/** Whether the Markdown language reads the note of a state. */
export function markdownGrammarOn(state: EditorState): boolean {
  return state.field(gateField, false)?.within ?? true;
}

/**
 * The change that turns the language on for a note that shows as plain text
 * and that the grammar now reads, or `null`.
 *
 * Only a note whose reading of the lines is unsure needs it: any other
 * answer is sure on each change. It reads the whole note once, so the gate
 * asks it after a pause in typing and never on a key.
 */
export function recheckPlainNote(state: EditorState): TransactionSpec | null {
  const value = state.field(gateField, false);
  const config = state.facet(gateConfig);
  if (value === undefined || config === null || value.within) return null;
  if (limitsOfMeasure(value.measure) !== 'unsure') return null;
  if (!config.checks.whole(state.doc.toString())) return null;
  return {
    effects: [
      setWithinLimits.of(true),
      grammarCompartment.reconfigure(config.markdown),
    ],
  };
}

/** Asks `recheckPlainNote` after each pause in typing in a plain note. */
const plainRecheck = ViewPlugin.fromClass(
  class {
    private readonly view: EditorView;
    private timer: number | null = null;

    constructor(view: EditorView) {
      this.view = view;
    }

    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      this.cancel();
      const value = update.state.field(gateField, false);
      if (value === undefined || value.within) return;
      if (limitsOfMeasure(value.measure) !== 'unsure') return;
      this.timer = window.setTimeout(() => {
        this.timer = null;
        const spec = recheckPlainNote(this.view.state);
        if (spec !== null) this.view.dispatch(spec);
      }, plainRecheckMs);
    }

    destroy(): void {
      this.cancel();
    }

    private cancel(): void {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = null;
    }
  },
);

/**
 * The Markdown language `markdown`, on while the note is within the limits
 * of the one grammar and off while it is not.
 *
 * `within` is the answer for the first document, which the caller reads
 * before it builds the state, because the compartment takes its first
 * content then. `checks` are the checks of `@notesapp/markdown` unless a
 * test counts them.
 */
export function gatedMarkdown(
  markdown: Extension,
  within: boolean,
  checks: GateChecks = markdownChecks,
): Extension {
  return [
    gateConfig.of({ markdown, checks }),
    gateField.init((state) => ({
      within,
      measure: measureNote(state.doc, checks.read),
      unchecked: 0,
    })),
    grammarCompartment.of(within ? markdown : []),
    plainRecheck,
    // The extender adds an effect only when the answer changes. A
    // transaction that it extends is a new one, whose state is computed
    // again, the parse of the language with it.
    EditorState.transactionExtender.of((transaction) => {
      if (!transaction.docChanged) return null;
      const value = transaction.startState.field(gateField, false);
      if (value === undefined) return null;
      const after = answerOf(transaction, value).within;
      if (after === value.within) return null;
      return {
        effects: [
          setWithinLimits.of(after),
          grammarCompartment.reconfigure(after ? markdown : []),
        ],
      };
    }),
  ];
}
