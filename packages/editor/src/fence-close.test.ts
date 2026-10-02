/**
 * Enter closes the fenced block that it opens.
 *
 * Each case builds a state with the note language, runs the command at the
 * caret `‸`, and compares the document and the caret. A case that declines
 * leaves Enter to the next command, so the document must stay whole.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { closeFenceSpec } from './fence-close.ts';
import { noteMarkdown, parsedWhole } from './language.ts';

/** A parsed state of `source`, whose caret is the `‸`. */
function stateOf(source: string): EditorState {
  const caret = source.indexOf('‸');
  assert.notEqual(caret, -1, 'the source needs a caret');
  return parsedWhole(
    EditorState.create({
      doc: source.replace('‸', ''),
      selection: { anchor: caret },
      extensions: [noteMarkdown()],
    }),
  );
}

/** The document after Enter, with its caret marked, or null on a decline. */
function entered(source: string): string | null {
  const state = stateOf(source);
  const spec = closeFenceSpec(state);
  if (spec === null) return null;
  const next = state.update(spec).state;
  const head = next.selection.main.head;
  const text = next.doc.toString();
  return `${text.slice(0, head)}‸${text.slice(head)}`;
}

await test('Enter after a typed fence writes its closer', () => {
  // The defect this covers: the fence stayed open, so every line below it
  // read as code until the person closed it.
  for (const [source, expected] of [
    ['```‸', '```\n‸\n```'],
    ['```js‸', '```js\n‸\n```'],
    ['~~~‸', '~~~\n‸\n~~~'],
    ['~~~ python‸', '~~~ python\n‸\n~~~'],
    ['````md‸', '````md\n‸\n````'],
    ['Text\n\n```‸\nBelow', 'Text\n\n```\n‸\n```\nBelow'],
  ] as const)
    assert.equal(entered(source), expected, source);
});

await test('Enter after a typed display math fence writes its closer', () => {
  assert.equal(entered('$$‸'), '$$\n‸\n$$');
  assert.equal(entered('$$$ tex‸'), '$$$ tex\n‸\n$$$');
  // Inline math on one line opens no block.
  assert.equal(entered('$$x$$‸'), null);
});

await test('the closed block keeps the text below it out of the block', () => {
  const state = stateOf('```js‸\nBelow');
  const spec = closeFenceSpec(state);
  assert.ok(spec !== null);
  const next = parsedWhole(state.update(spec).state);
  const names: string[] = [];
  syntaxTree(next).iterate({
    enter: (node) => {
      if (node.name === 'FencedCode' || node.name === 'Paragraph')
        names.push(node.name);
      return node.name !== 'FencedCode';
    },
  });
  assert.deepEqual(names, ['FencedCode', 'Paragraph']);
});

await test('a fence that already has its closer stays as it is', () => {
  // Enter on the opener of an existing block opens a line inside it, which
  // the plain new line already does.
  assert.equal(entered('```js‸\ncode\n```'), null);
  assert.equal(entered('$$‸\nx\n$$'), null);
  // A new opener above a later block takes the closer of that block in
  // CommonMark, so no second closer is written into the note.
  assert.equal(entered('```‸\nText\n\n```js\ncode\n```'), null);
});

await test('only the end of an opening line closes a fence', () => {
  assert.equal(entered('``‸`'), null);
  assert.equal(entered('```‸js'), null);
  // The closer of a block is not an opener.
  assert.equal(entered('```\ncode\n```‸'), null);
  // A shorter fence inside an open block is code.
  assert.equal(entered('````\n```‸'), null);
  // A backtick fence takes no backtick in its info string.
  assert.equal(entered('```a`‸'), null);
  assert.equal(entered('plain text‸'), null);
});

await test('a fence in a list item or a quote stays in its container', () => {
  assert.equal(entered('- ```‸'), '- ```\n  ‸\n  ```');
  assert.equal(entered('1. ```js‸'), '1. ```js\n   ‸\n   ```');
  assert.equal(entered('> ```‸'), '> ```\n> ‸\n> ```');
  assert.equal(entered('> $$‸'), '> $$\n> ‸\n> $$');
  assert.equal(entered('- item\n\n  ```‸'), '- item\n\n  ```\n  ‸\n  ```');
});

await test('a selection or a second caret declines', () => {
  const ranged = EditorState.create({
    doc: '```',
    selection: { anchor: 0, head: 3 },
    extensions: [noteMarkdown()],
  });
  assert.equal(closeFenceSpec(ranged), null);
});
