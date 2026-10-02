/**
 * The bar of a code block (record 0174): which blocks carry one, their
 * labels, and the code that a copy takes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import {
  codeBlockBars,
  codeBlockSelection,
  codeBlockText,
} from './code-controls.ts';
import { noteMarkdown, parsedWhole } from './language.ts';

/** A state of the note grammar with the whole text parsed. */
function stateOf(doc: string): EditorState {
  return parsedWhole(EditorState.create({ doc, extensions: [noteMarkdown()] }));
}

const note = [
  '# Code',
  '',
  '```py',
  'x = 1',
  '```',
  '',
  '```mermaid',
  'graph TD;',
  '```',
  '',
  '```cobol extra words',
  'MOVE A TO B.',
  '```',
  '',
  '    indented line',
  '',
  '> ```sh',
  '> echo a',
  '> echo b',
  '> ```',
  '',
  '- item',
  '',
  '  ```',
  '  in a list',
  '  ```',
  '',
].join('\n');

await test('each code block carries a bar with its label, and a diagram none', () => {
  assert.deepEqual(
    codeBlockBars(stateOf(note)).map((bar) => bar.label),
    ['Python', 'cobol', null, 'Shell', null],
  );
});

await test('a copy takes the code of the block as the renderer reads it', () => {
  const state = stateOf(note);
  const bars = codeBlockBars(state);
  const text = state.doc.toString();
  assert.deepEqual(
    bars.map((bar) => codeBlockText(text, bar.from)),
    ['x = 1', 'MOVE A TO B.', 'indented line', 'echo a\necho b', 'in a list'],
  );
  // A place outside every block holds no code.
  assert.equal(codeBlockText(text, 0), null);
});

await test('a fence that is a diagram by its first word carries no bar', () => {
  // Review of record 0174: one rule decides a diagram on every surface.
  assert.deepEqual(
    codeBlockBars(stateOf('```mermaid title\ngraph TD;\n```\n')),
    [],
  );
});

await test('a refused copy selects the code of its block and no fence', () => {
  // Review of record 0174: a copy that the browser refused did nothing, and
  // its rejection went unhandled. The one failure path selects the code.
  const state = stateOf(note);
  const text = state.doc.toString();
  assert.deepEqual(
    codeBlockBars(state).map((bar) => {
      const range = codeBlockSelection(state, bar.from);
      return range === null ? null : text.slice(range.from, range.to);
    }),
    ['x = 1', 'MOVE A TO B.', 'indented line', 'echo a\n> echo b', 'in a list'],
  );
  const empty = stateOf('```js\n```\n');
  assert.deepEqual(codeBlockSelection(empty, 0), { from: 5, to: 5 });
  assert.equal(codeBlockSelection(state, 1), null);
});
