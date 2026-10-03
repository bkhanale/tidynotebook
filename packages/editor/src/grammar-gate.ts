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
 * tell. Then the editor copies the note and asks `withinParseLimits` when the
 * change inserts much text, which a paste does. A small change keeps the
 * answer: it adds a few marks to a block that the parser reads quickly. A
 * note that shows as plain text is asked again after a pause in typing, so
 * that its formatting comes back once the note is within the limits again,
 * and no key copies the whole note.
 */
import {
  Compartment,
  EditorState,
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
 * The text that one change inserts before the editor checks the whole note
 * at once. A paste of a block of marks reaches it, and a key does not.
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
};

/** Sets what the gate knows after a change. */
const setGate = StateEffect.define<GateValue>();

/** What the gate knows of the note of a state. */
const gateField = StateField.define<GateValue>({
  create: (state) => {
    const source = state.doc.toString();
    return {
      within: withinParseLimits(source),
      measure: measureNote(state.doc),
    };
  },
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setGate)) return effect.value;
    if (!transaction.docChanged) return value;
    // A change that the gate did not extend: a transaction filter reads the
    // state of a change before the extenders run, as the list numbering
    // does. That reading follows the parts around the change as well, and
    // the language waits for the change that the gate extends.
    return {
      ...value,
      measure: measureAfter(
        value.measure,
        transaction.startState.doc,
        transaction.changes,
        transaction.newDoc,
        transaction.startState.facet(gateConfig)?.checks.read,
      ),
    };
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

/** Whether the note after `transaction` is within the limits. */
function withinAfter(
  transaction: Transaction,
  before: boolean,
  measure: PartsMeasure,
  checks: GateChecks,
): boolean {
  const lines = limitsOfMeasure(measure);
  if (lines !== 'unsure') return lines === 'within';
  if (insertedLength(transaction) < checkedInsertLength) return before;
  return checks.whole(transaction.newDoc.toString());
}

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
      setGate.of({ within: true, measure: value.measure }),
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
    })),
    grammarCompartment.of(within ? markdown : []),
    plainRecheck,
    EditorState.transactionExtender.of((transaction) => {
      if (!transaction.docChanged) return null;
      const value = transaction.startState.field(gateField, false);
      if (value === undefined) return null;
      const measure = measureAfter(
        value.measure,
        transaction.startState.doc,
        transaction.changes,
        transaction.newDoc,
        checks.read,
      );
      const after = withinAfter(transaction, value.within, measure, checks);
      const set = setGate.of({ within: after, measure });
      if (after === value.within) return { effects: set };
      return {
        effects: [set, grammarCompartment.reconfigure(after ? markdown : [])],
      };
    }),
  ];
}
