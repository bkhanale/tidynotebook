/**
 * The slash menu (issue 259): where it opens, and which blocks it offers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { history, redo, undo, undoDepth } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { noteMarkdown, parsedWhole } from './language.ts';
import {
  chooseSlashBlock,
  slashChoiceSpec,
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
  assert.deepEqual(
    menuAt('/‸'),
    blocks.map((block) => block.id),
  );
  assert.deepEqual(
    menuAt('Some text /‸'),
    blocks.map((block) => block.id),
  );
  assert.deepEqual(
    menuAt('- /‸'),
    blocks.map((block) => block.id),
  );
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

/** A state of `text` with the caret at `‸` and a history. */
function stateWithHistory(text: string): EditorState {
  const at = text.indexOf('‸');
  return parsedWhole(
    EditorState.create({
      doc: text.replace('‸', ''),
      selection: { anchor: at },
      extensions: [noteMarkdown(), slashCommands(blocks), history()],
    }),
  );
}

/** Runs one history command on a state and answers the state after it. */
function afterCommand(state: EditorState, command: typeof undo): EditorState {
  let next = state;
  command({
    state,
    dispatch: (transaction) => {
      next = transaction.state;
    },
  });
  return next;
}

await test('a choice of a block is one transaction and one step of undo', () => {
  // Review of issue 259: the removal of the slash and the block were two
  // transactions, so one undo left the note between them.
  const typed = stateWithHistory('Intro\n\n/hea‸');
  const caret = typed.selection.main.head;
  const menu = slashMenuAt(typed, caret);
  assert.ok(menu !== null);
  const chosen = typed.update(
    slashChoiceSpec(typed, menu.from, caret, 'heading-2'),
  ).state;
  assert.equal(chosen.doc.toString(), 'Intro\n\n## ');
  assert.equal(chosen.selection.main.head, chosen.doc.length);
  assert.equal(undoDepth(chosen), 1);
  const undone = afterCommand(chosen, undo);
  assert.equal(undone.doc.toString(), 'Intro\n\n/hea');
  assert.equal(afterCommand(undone, redo).doc.toString(), 'Intro\n\n## ');
  const table = typed.update(
    slashChoiceSpec(typed, menu.from, caret, 'table'),
  ).state;
  assert.equal(undoDepth(table), 1);
  assert.equal(afterCommand(table, undo).doc.toString(), 'Intro\n\n/hea');
});

await test('a choice waits while the view composes', () => {
  // Review of issue 259: the choice ran inside an IME composition, which
  // loses the composed characters (record 0082).
  const sent: unknown[] = [];
  const view = {
    composing: true,
    state: stateWithHistory('/bul‸'),
    dispatch: (...specs: unknown[]): void => {
      sent.push(...specs);
    },
    focus: (): void => undefined,
  };
  assert.equal(chooseSlashBlock(view, 0, 4, 'bullet-list'), false);
  assert.equal(sent.length, 0);
  view.composing = false;
  assert.equal(chooseSlashBlock(view, 0, 4, 'bullet-list'), true);
  assert.equal(sent.length, 1);
});
