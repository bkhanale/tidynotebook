/**
 * The Markdown language of the editor follows the limits of the one grammar
 * (record 0182). Each test builds a state with no view, as the editor builds
 * it, and reads whether the language parses the note.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
  markdownLimits,
  measureParts,
  withinParseLimits,
} from '@notesapp/markdown';
import {
  checkedInsertLength,
  gatedMarkdown,
  markdownGrammarOn,
  recheckPlainNote,
  type GateChecks,
} from './grammar-gate.ts';
import { noteMarkdownExtensions, parsedWhole } from './language.ts';

/** A state of the editor language for `doc`, as `createEditor` builds it. */
function stateOf(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      gatedMarkdown(noteMarkdownExtensions(), withinParseLimits(doc)),
    ],
  });
}

/** A paragraph of `marks` marks: links of two marks each. */
function paragraphOfMarks(marks: number): string {
  return `${'a [link](u) '.repeat(Math.floor(marks / 2))}${marks % 2 === 1 ? '_x' : 'x'}`;
}

const limit = markdownLimits.maxBlockMarks;

await test('a note within the limits keeps its Markdown language', () => {
  const state = parsedWhole(stateOf('# Plan\n\nSome **bold** text.\n'));
  assert.equal(markdownGrammarOn(state), true);
  assert.ok(syntaxTree(state).length > 0);
});

await test('a note over a limit shows as plain text, as a reader shows it', () => {
  // The audit of 2026-10-02. A long run of nested emphasis ran the Lezer
  // parser of the editor out of stack, so the note froze its tab. The note
  // is over the mark limit of the grammar, which every reader refuses.
  const deep = `${'*a '.repeat(30000)}x${' b*'.repeat(30000)}\n`;
  const state = stateOf(deep);
  assert.equal(markdownGrammarOn(state), false);
  // No parser reads the note, so every layer of the preview reads an empty
  // tree and draws nothing.
  assert.equal(syntaxTree(state).length, 0);
  assert.equal(syntaxTree(state.update({}).state).length, 0);
});

await test('a paste over a limit turns the language off in the same change', () => {
  const state = stateOf('A short note.\n');
  const paste = `\n${paragraphOfMarks(limit + 1)}\n`;
  assert.ok(paste.length < checkedInsertLength);
  // A paste of a block of marks, and a table with more cells than a note may
  // hold. The reading of the lines decides the second one with no copy.
  const pasted = state.update({
    changes: { from: state.doc.length, insert: paste.repeat(40) },
  }).state;
  assert.equal(markdownGrammarOn(pasted), false);
  const table = `|a|\n|-|\n${'|c|\n'.repeat(markdownLimits.maxTableCells)}`;
  const tabled = state.update({
    changes: { from: state.doc.length, insert: table },
  }).state;
  assert.equal(markdownGrammarOn(tabled), false);
});

await test('the language comes back when the note is within the limits again', () => {
  const over = paragraphOfMarks(limit + 1);
  const state = stateOf(over);
  assert.equal(markdownGrammarOn(state), false);
  // A blank line divides the paragraph into two blocks within the limit.
  const middle = over.indexOf('a [link]', over.length / 2);
  const divided = state.update({
    changes: { from: middle, insert: '\n\n' },
  }).state;
  assert.equal(markdownGrammarOn(divided), true);
  assert.ok(syntaxTree(parsedWhole(divided)).length > 0);
});

await test('a key in a long list keeps the language with no copy of the note', () => {
  // The part around the list holds more marks than one block may, so the
  // reading of the lines is unsure, and each item is within the limit.
  const list = Array.from(
    { length: 20 },
    () => `- ${paragraphOfMarks(limit - 8)}`,
  ).join('\n');
  const state = stateOf(list);
  assert.equal(markdownGrammarOn(state), true);
  const typed = state.update({ changes: { from: 2, insert: 'k' } }).state;
  assert.equal(markdownGrammarOn(typed), true);
});

/** Checks of the gate that count the lines and the whole notes they read. */
function countingChecks(): GateChecks & {
  readonly lines: () => number;
  readonly wholes: () => number;
  readonly reset: () => void;
} {
  let lines = 0;
  let wholes = 0;
  return {
    read: (source) =>
      measureParts(
        (function* counted(): Generator<string> {
          for (const line of source) {
            lines += 1;
            yield line;
          }
        })(),
      ),
    whole: (source) => {
      wholes += 1;
      return withinParseLimits(source);
    },
    lines: () => lines,
    wholes: () => wholes,
    reset: () => {
      lines = 0;
      wholes = 0;
    },
  };
}

/** A long note of many parts, as the typing measurement opens it. */
function longNote(parts: number): string {
  return Array.from(
    { length: parts },
    (_, index) =>
      `## Part ${String(index)}\n\nSome *words* and a [link](u).\n\n- one\n- [ ] two`,
  ).join('\n\n');
}

await test('a key in a long note reads only the lines around it', () => {
  // The audit of the typing of 2026-10-03: the gate read every line of a
  // note of 500 KB on each key, so at 4x CPU a key took longer than the gap
  // to the next one and the keys queued.
  const doc = longNote(5000);
  const checks = countingChecks();
  const state = EditorState.create({
    doc,
    extensions: [gatedMarkdown(noteMarkdownExtensions(), true, checks)],
  });
  checks.reset();
  let typed = state;
  const at = doc.indexOf('Some *words*', doc.length / 2);
  for (const [index, key] of [...'the *quick* fox'].entries())
    typed = typed.update({ changes: { from: at + index, insert: key } }).state;
  assert.equal(markdownGrammarOn(typed), true);
  assert.equal(checks.wholes(), 0);
  // Each key reads the paragraph and a blank line on each side, before and
  // after the key: six lines, never the note.
  assert.equal(checks.lines(), 15 * 6);
});

await test('a key in a note shown as plain text copies no note', () => {
  // A note over the mark limit, inside a long note. A key in it read the
  // whole note and parsed its blocks on each key.
  const over = paragraphOfMarks(limit + 1);
  const doc = `${longNote(500)}\n\n${over}\n`;
  const checks = countingChecks();
  const state = EditorState.create({
    doc,
    extensions: [
      gatedMarkdown(noteMarkdownExtensions(), withinParseLimits(doc), checks),
    ],
  });
  assert.equal(markdownGrammarOn(state), false);
  checks.reset();
  // A heading line inside the paragraph ends it in two blocks within the
  // limit, but the part between blank lines still holds every mark.
  const middle = doc.indexOf('a [link]', doc.length - over.length / 2);
  const divided = state.update({
    changes: { from: middle, insert: '\n# Middle\n' },
  }).state;
  assert.equal(checks.wholes(), 0);
  assert.equal(markdownGrammarOn(divided), false);
  // After a pause in typing the gate asks the whole note once, and the
  // formatting comes back.
  const spec = recheckPlainNote(divided);
  assert.ok(spec !== null);
  assert.equal(checks.wholes(), 1);
  const back = divided.update(spec).state;
  assert.equal(markdownGrammarOn(back), true);
  assert.ok(syntaxTree(parsedWhole(back)).length > 0);
  // A note within the limits needs no question.
  assert.equal(recheckPlainNote(back), null);
});

await test('a large paste into a note of full parts checks the whole note once', () => {
  const list = Array.from(
    { length: 20 },
    () => `- ${paragraphOfMarks(limit - 8)}`,
  ).join('\n');
  const checks = countingChecks();
  const state = EditorState.create({
    doc: list,
    extensions: [gatedMarkdown(noteMarkdownExtensions(), true, checks)],
  });
  checks.reset();
  const pasted = state.update({
    changes: { from: 0, insert: `- ${'plain words '.repeat(400)}\n` },
  }).state;
  assert.equal(checks.wholes(), 1);
  assert.equal(markdownGrammarOn(pasted), true);
});

await test('a filter that reads the state of a key reads no whole note either', () => {
  // The list numbering reads the state of each change in a transaction
  // filter, before the gate extends the change, and in the browser that
  // state read every line of the note on each key.
  const doc = longNote(5000);
  const checks = countingChecks();
  const state = EditorState.create({
    doc,
    extensions: [
      gatedMarkdown(noteMarkdownExtensions(), true, checks),
      EditorState.transactionFilter.of((transaction) => {
        if (transaction.docChanged) assert.ok(transaction.state.doc.length > 0);
        return transaction;
      }),
    ],
  });
  checks.reset();
  const at = doc.indexOf('Some *words*', doc.length / 2);
  const typed = state.update({ changes: { from: at, insert: 'k' } }).state;
  assert.equal(markdownGrammarOn(typed), true);
  assert.equal(checks.wholes(), 0);
  // The filter and the gate read the paragraph around the key once.
  assert.equal(checks.lines(), 6);
});

await test('a key that keeps the answer adds nothing to its change', () => {
  // A transaction that an extender extends is a new transaction, so the
  // editor computed the state of each key twice, the parse of the language
  // with it, when the gate added an effect to every key.
  const state = stateOf(longNote(50));
  const key = state.update({ changes: { from: 3, insert: 'k' } });
  assert.deepEqual(key.effects, []);
  const over = state.update({
    changes: {
      from: 0,
      insert: `${'> '.repeat(markdownLimits.maxNestingDepth + 1)}x\n`,
    },
  });
  assert.equal(over.effects.length, 2);
  assert.equal(markdownGrammarOn(over.state), false);
});
