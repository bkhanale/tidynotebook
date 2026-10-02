/**
 * The bar of a code block (record 0174): which blocks carry one, their
 * labels, and the code that a copy takes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { codeBlockBars, codeBlockText } from './code-controls.ts';
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
