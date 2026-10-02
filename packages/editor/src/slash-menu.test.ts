/**
 * The slash menu (issue 259): where it opens, and which blocks it offers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { noteMarkdown, parsedWhole } from './language.ts';
import {
  slashCommands,
  slashMatches,
  slashMenuAt,
  type SlashCommand,
} from './slash-menu.ts';

/** The blocks that the note screen gives, as the row lists them. */
const blocks: readonly SlashCommand[] = [
  { id: 'heading-1', keywords: 'h1 title', hint: 'Ctrl + 1' },
  { id: 'heading-2', keywords: 'h2 title', hint: 'Ctrl + 2' },
  { id: 'bullet-list', keywords: 'unordered', hint: null },
  { id: 'task-list', keywords: 'checklist todo checkbox', hint: null },
  { id: 'quote', keywords: 'quotation', hint: null },
  { id: 'table', keywords: 'grid columns rows', hint: null },
];

/** The labels that the menu offers with the caret at `‸`, or `null`. */
function menuAt(text: string): readonly string[] | null {
  const at = text.indexOf('‸');
  const state = parsedWhole(
    EditorState.create({
      doc: text.replace('‸', ''),
      selection: { anchor: at },
      extensions: [noteMarkdown(), slashCommands(blocks)],
    }),
  );
  return slashMenuAt(state, at)?.commands.map((command) => command.id) ?? null;
}

await test('a slash at the start of a line or after a space opens the blocks', () => {
  assert.deepEqual(menuAt('/‸'), blocks.map((block) => block.id));
  assert.deepEqual(menuAt('Some text /‸'), blocks.map((block) => block.id));
  assert.deepEqual(menuAt('- /‸'), blocks.map((block) => block.id));
});

await test('the words after the slash narrow the blocks', () => {
  assert.deepEqual(menuAt('/bul‸'), ['bullet-list']);
  assert.deepEqual(menuAt('/h2‸'), ['heading-2']);
  assert.deepEqual(menuAt('/head‸'), ['heading-1', 'heading-2']);
  assert.deepEqual(menuAt('/todo‸'), ['task-list']);
  assert.deepEqual(menuAt('/TABLE‸'), ['table']);
  assert.equal(menuAt('/nothing‸'), null);
});

await test('a slash in a word, an address, code or math is text', () => {
  for (const text of [
    'and/or‸',
    'https://example.com/‸',
    '`code /‸`',
    '```\n/‸\n```',
    '    indented /‸',
    'A formula $a /‸ b$',
    '[a link](/notes/‸)',
  ])
    assert.equal(menuAt(text), null, text);
});

await test('inside a table no block applies, so no menu opens', () => {
  assert.equal(menuAt('| a | b |\n| - | - |\n| /‸ | c |\n'), null);
});

await test('a block matches the start of a word of its name or its words', () => {
  const quote = blocks.find((block) => block.id === 'quote');
  assert.ok(quote !== undefined);
  assert.equal(slashMatches(quote, ''), true);
  assert.equal(slashMatches(quote, 'blo'), true);
  assert.equal(slashMatches(quote, 'quo'), true);
  assert.equal(slashMatches(quote, 'uote'), false);
});
