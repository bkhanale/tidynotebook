/**
 * The Markdown language of the editor follows the limits of the one grammar
 * (record 0186). Each test builds a state with no view, as the editor builds
 * it, and reads whether the language parses the note.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { markdownLimits, withinParseLimits } from '@notesapp/markdown';
import {
  checkedInsertLength,
  gatedMarkdown,
  markdownGrammarOn,
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
