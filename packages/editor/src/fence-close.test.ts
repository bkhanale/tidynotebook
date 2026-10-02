/**
 * Enter closes the fenced block that it opens.
 *
 * Each case builds a state with the note language, runs the command at the
 * caret `‸`, and compares the document and the caret. A case that declines
 * leaves Enter to the next command, so the document must stay whole.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { closeFenceSpec, typedFenceOpeners } from './fence-close.ts';
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
    ['Text\n\n```‸', 'Text\n\n```\n‸\n```'],
    ['Text\n\n```‸\n\n', 'Text\n\n```\n‸\n```\n\n'],
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
  // The quote ends at the line below, so the fence holds no text yet.
  const state = stateOf('> ```js‸\nBelow');
  const spec = closeFenceSpec(state);
  assert.ok(spec !== null);
  const next = parsedWhole(state.update(spec).state);
  assert.equal(next.doc.toString(), '> ```js\n> \n> ```\nBelow');
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

await test('a fence with no closer that holds code stays as it is', () => {
  // The defect this covers: a note that ends with an open fence of code. A
  // person edits the language of the fence and presses Enter, and the closer
  // went under the opener and turned every line of the code into prose.
  const code = Array.from(
    { length: 30 },
    (_, index) => `const v${String(index)} = ${String(index)};`,
  ).join('\n');
  assert.equal(entered(`Text\n\n\`\`\`ts‸\n${code}`), null);
  assert.equal(entered('```‸\nBelow'), null);
  assert.equal(entered('```‸\n\n\nBelow'), null);
  assert.equal(entered('$$‸\nx^2'), null);
});

await test('Enter on a line that cannot open a fence parses nothing', () => {
  // The defect this covers: every Enter at the end of a line parsed the whole
  // note to look for a fence, which costs a long note a parse per key press.
  const filler = Array.from(
    { length: 4000 },
    (_, index) => `Line ${String(index)} of a long note.`,
  ).join('\n\n');
  const doc = `Plain text\n\n${filler}`;
  const state = EditorState.create({
    doc,
    selection: { anchor: 'Plain text'.length },
    extensions: [noteMarkdown()],
  });
  assert.equal(syntaxTreeAvailable(state, doc.length), false);
  assert.equal(closeFenceSpec(state), null);
  assert.equal(syntaxTreeAvailable(state, doc.length), false);
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

/**
 * A state of `source` whose caret is the `‸`, after a person typed `typing`
 * there one key at a time, or pasted it when `event` says so.
 */
function afterTyping(
  source: string,
  typing: string,
  event = 'input.type',
): EditorState {
  const caret = source.indexOf('‸');
  let state = EditorState.create({
    doc: source.replace('‸', ''),
    selection: { anchor: caret },
    extensions: [noteMarkdown(), typedFenceOpeners, history()],
  });
  const keys = event === 'input.type' ? typing.split('') : [typing];
  for (const key of keys) {
    const at = state.selection.main.head;
    state = state.update({
      changes: { from: at, insert: key },
      selection: EditorSelection.cursor(at + key.length),
      userEvent: event,
    }).state;
  }
  return parsedWhole(state);
}

/** The document after Enter on a state, with its caret, or null. */
function enteredOn(state: EditorState): string | null {
  const spec = closeFenceSpec(state);
  if (spec === null) return null;
  const next = state.update(spec).state;
  const head = next.selection.main.head;
  const text = next.doc.toString();
  return `${text.slice(0, head)}‸${text.slice(head)}`;
}

await test('a fence typed above text closes, and the text stays outside it', () => {
  // The defect this covers: a person typed a fence above their prose, and
  // Enter left it open, so every line below read as code.
  const state = afterTyping('‸\nSome prose.\nMore prose.', '```js');
  assert.equal(enteredOn(state), '```js\n‸\n```\nSome prose.\nMore prose.');
  const spec = closeFenceSpec(state);
  assert.ok(spec !== null);
  const next = parsedWhole(state.update(spec).state);
  const blocks: string[] = [];
  syntaxTree(next).iterate({
    enter: (node) => {
      if (node.name === 'FencedCode' || node.name === 'Paragraph')
        blocks.push(`${node.name}:${next.doc.sliceString(node.from, node.to)}`);
      return node.name !== 'FencedCode' && node.name !== 'Paragraph';
    },
  });
  assert.deepEqual(blocks, [
    'FencedCode:```js\n\n```',
    'Paragraph:Some prose.\nMore prose.',
  ]);
  // A typed math fence above text closes the same way.
  assert.equal(
    enteredOn(afterTyping('‸\nA line.', '$$')),
    '$$\n‸\n$$\nA line.',
  );
});

await test('editing the language of a fence of code does not close it', () => {
  // The line opened the fence before the person came to it, so the lines
  // below are code.
  const state = afterTyping('Text\n\n```‸\nconst a = 1;\nconst b = 2;', 'ts');
  assert.equal(enteredOn(state), null);
});

await test('a fence typed in an empty note closes', () => {
  assert.equal(enteredOn(afterTyping('‸', '```')), '```\n‸\n```');
  assert.equal(enteredOn(afterTyping('‸', '~~~ py')), '~~~ py\n‸\n~~~');
});

await test('a pasted opener, or one the caret left, is not a typed opener', () => {
  const pasted = afterTyping('‸\nSome prose.', '```', 'input.paste');
  assert.equal(enteredOn(pasted), null);
  const typed = afterTyping('‸\nSome prose.', '```');
  const away = typed.update({
    selection: EditorSelection.cursor(typed.doc.length),
    userEvent: 'select',
  }).state;
  const back = away.update({
    selection: EditorSelection.cursor(3),
    userEvent: 'select',
  }).state;
  assert.equal(enteredOn(back), null);
});

await test('one undo removes the closer and the new line together', () => {
  const state = afterTyping('‸\nSome prose.', '```');
  const spec = closeFenceSpec(state);
  assert.ok(spec !== null);
  let next = state.update({ ...spec, userEvent: 'input' }).state;
  assert.equal(next.doc.toString(), '```\n\n```\nSome prose.');
  undo({
    state: next,
    dispatch: (transaction) => {
      next = transaction.state;
    },
  });
  assert.equal(next.doc.toString(), '```\nSome prose.');
});
