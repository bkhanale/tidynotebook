/**
 * Formatting command checks.
 *
 * Every command is a pure function of `EditorState`, so each test builds a
 * state, applies the returned transaction, and compares the resulting
 * document and selection. No DOM, no view, and no browser is involved.
 *
 * The notation in these tests marks the selection inside the source text:
 * `‸` is a cursor and `«text»` is a range.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { noteMarkdownExtensions } from './language.ts';
import {
  addColumnEdit,
  addRowEdit,
  alignColumnEdit,
  insertColumnLeftEdit,
  insertRowAboveEdit,
  moveColumnLeftEdit,
  moveColumnRightEdit,
  moveRowDownEdit,
  moveRowUpEdit,
  removeColumnEdit,
  removeRowEdit,
  deleteTableSpec,
  tableEditSpec,
} from './table-grid.ts';
import {
  continueBlockSpec,
  formatActionOf,
  formatActions,
  formattingKeymap,
  hardBreakSpec,
  headingLevelSpec,
  indentListSpec,
  inListItem,
  insideCodeFence,
  isLinkDestination,
  leaveTableBelowSpec,
  linkDestinationSpec,
  linkSpec,
  outdentListSpec,
  parseListLine,
  shortcutKeys,
  shortcuts,
  tableSpec,
  toggleInlineSpec,
  toggleListSpec,
  toggleQuoteSpec,
  type FormatActionId,
} from './keymaps.ts';

/** Builds a state from text that marks its selection. */
function stateOf(source: string): EditorState {
  const rangeStart = source.indexOf('«');
  if (rangeStart !== -1) {
    const withoutStart = source.replace('«', '');
    const rangeEnd = withoutStart.indexOf('»');
    assert.notEqual(rangeEnd, -1, 'a range needs both markers');
    return EditorState.create({
      doc: withoutStart.replace('»', ''),
      selection: { anchor: rangeStart, head: rangeEnd },
      extensions: [noteMarkdownExtensions()],
    });
  }
  const cursor = source.indexOf('‸');
  assert.notEqual(cursor, -1, 'the source needs a cursor or a range');
  return EditorState.create({
    doc: source.replace('‸', ''),
    selection: { anchor: cursor },
    extensions: [noteMarkdownExtensions()],
  });
}

/** Applies a spec and returns the document with its selection marked. */
function applied(state: EditorState, spec: TransactionSpec | null): string {
  assert.notEqual(spec, null, 'the command declined');
  if (spec === null) return '';
  const next = state.update(spec).state;
  const { from, to } = next.selection.main;
  const text = next.doc.toString();
  return from === to
    ? `${text.slice(0, from)}‸${text.slice(from)}`
    : `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`;
}

await test('bold wraps a selection and keeps it selected', () => {
  const state = stateOf('say «hello» now');
  assert.equal(
    applied(state, toggleInlineSpec(state, '**')),
    'say **«hello»** now',
  );
});

await test('bold on bold text removes the markers', () => {
  const inside = stateOf('say **«hello»** now');
  assert.equal(
    applied(inside, toggleInlineSpec(inside, '**')),
    'say «hello» now',
  );
  const around = stateOf('say «**hello**» now');
  assert.equal(
    applied(around, toggleInlineSpec(around, '**')),
    'say «hello» now',
  );
});

await test('bold with an empty selection leaves the cursor between markers', () => {
  const state = stateOf('say ‸now');
  assert.equal(applied(state, toggleInlineSpec(state, '**')), 'say **‸**now');
});

await test('italic does not break a bold pair', () => {
  const state = stateOf('say **«hello»** now');
  assert.equal(
    applied(state, toggleInlineSpec(state, '*')),
    'say ***«hello»*** now',
  );
});

await test('inline code and strike through toggle both ways', () => {
  const code = stateOf('run «npm test» here');
  assert.equal(
    applied(code, toggleInlineSpec(code, '`')),
    'run `«npm test»` here',
  );
  const struck = stateOf('drop «~~this~~» now');
  assert.equal(
    applied(struck, toggleInlineSpec(struck, '~~')),
    'drop «this» now',
  );
});

await test('a link puts the cursor inside the empty destination', () => {
  const state = stateOf('read «the plan» today');
  assert.equal(applied(state, linkSpec(state)), 'read [the plan](‸) today');
});

await test('a selected URL becomes the destination', () => {
  const state = stateOf('see «https://example.com/page» now');
  assert.equal(
    applied(state, linkSpec(state)),
    'see [‸](https://example.com/page) now',
  );
});

await test('a URL from the clipboard fills the empty destination', () => {
  const state = stateOf('see «the page» now');
  const linked = state.update(linkSpec(state)).state;
  const at = linked.selection.main.head;
  assert.equal(
    applied(
      linked,
      linkDestinationSpec(linked, at, 'https://example.com/page'),
    ),
    'see [the page](https://example.com/page)‸ now',
  );
});

await test('a clipboard value that is not a URL fills nothing', () => {
  const state = stateOf('see «the page» now');
  const linked = state.update(linkSpec(state)).state;
  const at = linked.selection.main.head;
  assert.equal(linkDestinationSpec(linked, at, 'not a url'), null);
  assert.equal(linkDestinationSpec(linked, at, null), null);
  assert.ok(!isLinkDestination('not a url'));
  assert.ok(isLinkDestination('https://example.com'));
  assert.ok(isLinkDestination('mailto:someone@example.com'));
});

await test('the clipboard fills only an empty pair of parentheses', () => {
  // The fill arrives after a clipboard read, so it must never write into
  // text that is not the link the command just wrote.
  const filled = stateOf('see [the page](https://a.example)‸ now');
  const at = filled.selection.main.head;
  assert.equal(linkDestinationSpec(filled, at, 'https://b.example'), null);
  const plain = stateOf('‸text');
  assert.equal(linkDestinationSpec(plain, 0, 'https://b.example'), null);
});

await test('a heading level applies and toggles off', () => {
  const plain = stateOf('Title‸');
  assert.equal(applied(plain, headingLevelSpec(plain, 2)), '## Title‸');
  const second = stateOf('## Title‸');
  assert.equal(applied(second, headingLevelSpec(second, 2)), 'Title‸');
  const third = stateOf('## Title‸');
  assert.equal(applied(third, headingLevelSpec(third, 3)), '### Title‸');
});

await test('a bullet list applies to every selected line and toggles off', () => {
  // A marker inserted at the selection start sits outside the selection
  // afterwards, so the range still covers exactly the text it covered.
  const plain = stateOf('«one\ntwo\nthree»');
  assert.equal(
    applied(plain, toggleListSpec(plain, 'bullet')),
    '- «one\n- two\n- three»',
  );
  const listed = stateOf('«- one\n- two»');
  assert.equal(applied(listed, toggleListSpec(listed, 'bullet')), '«one\ntwo»');
});

await test('an ordered list numbers the selection from one', () => {
  const state = stateOf('«one\ntwo\nthree»');
  assert.equal(
    applied(state, toggleListSpec(state, 'ordered')),
    '1. «one\n2. two\n3. three»',
  );
});

await test('a task list converts a bullet list in place', () => {
  const state = stateOf('«- one\n- two»');
  assert.equal(
    applied(state, toggleListSpec(state, 'task')),
    '«- [ ] one\n- [ ] two»',
  );
  const tasks = stateOf('«- [ ] one\n- [x] two»');
  assert.equal(applied(tasks, toggleListSpec(tasks, 'task')), '«one\ntwo»');
});

await test('a block quote applies and toggles off', () => {
  const plain = stateOf('«one\ntwo»');
  assert.equal(applied(plain, toggleQuoteSpec(plain)), '> «one\n> two»');
  const quoted = stateOf('«> one\n> two»');
  assert.equal(applied(quoted, toggleQuoteSpec(quoted)), '«one\ntwo»');
});

await test('a block marker puts a lone caret after itself', () => {
  // A person who starts a heading, a list or a quote on an empty line types
  // the text next. A caret left in front of the new marker put that text in
  // front of it, where it is no longer a heading, an item or a quote.
  const heading = stateOf('one\n‸\ntwo');
  assert.equal(
    applied(heading, headingLevelSpec(heading, 2)),
    'one\n## ‸\ntwo',
  );
  for (const [kind, marker] of [
    ['bullet', '- '],
    ['ordered', '1. '],
    ['task', '- [ ] '],
  ] as const) {
    const empty = stateOf('‸');
    assert.equal(applied(empty, toggleListSpec(empty, kind)), `${marker}‸`);
  }
  const quote = stateOf('‸');
  assert.equal(applied(quote, toggleQuoteSpec(quote)), '> ‸');
  // A caret at the start of a line of text stays in front of that text.
  const start = stateOf('‸Title');
  assert.equal(applied(start, headingLevelSpec(start, 1)), '# ‸Title');
  // A caret inside a marker that changes shape lands after the new marker.
  const inside = stateOf('-‸ one');
  assert.equal(applied(inside, toggleListSpec(inside, 'ordered')), '1. ‸one');
});

await test('indent and outdent move one list item', () => {
  const item = stateOf('- one\n- t‸wo');
  assert.equal(applied(item, indentListSpec(item)), '- one\n  - t‸wo');
  const nested = stateOf('- one\n  - t‸wo');
  assert.equal(applied(nested, outdentListSpec(nested)), '- one\n- t‸wo');
});

await test('indent nests an ordered item at the content column above it', () => {
  // The defect this covers: the indent unit is two spaces and a `1. ` item
  // holds its text at the third column, so Tab left an ordered item in the
  // list it was in and the list gained no level (record 0089).
  const ordered = stateOf('1. one\n2. t‸wo');
  assert.equal(applied(ordered, indentListSpec(ordered)), '1. one\n   2. t‸wo');
  const wide = stateOf('10. one\n11. t‸wo');
  assert.equal(applied(wide, indentListSpec(wide)), '10. one\n    11. t‸wo');
  // A deeper line above belongs to the item above, so the walk passes it.
  const deep = stateOf('1. one\n   - inner\n\n2. t‸wo');
  assert.equal(
    applied(deep, indentListSpec(deep)),
    '1. one\n   - inner\n\n   2. t‸wo',
  );
});

await test('indent moves the lines of an item with it', () => {
  const state = stateOf('1. one\n2. t‸wo\n   - child\n   more text\n3. three');
  assert.equal(
    applied(state, indentListSpec(state)),
    '1. one\n   2. t‸wo\n      - child\n      more text\n3. three',
  );
});

await test('outdent moves an item to the column of its parent', () => {
  const state = stateOf('1. one\n   1. t‸wo\n      - child\n2. three');
  assert.equal(
    applied(state, outdentListSpec(state)),
    '1. one\n1. t‸wo\n   - child\n2. three',
  );
});

await test('the first item of a list takes one indent unit', () => {
  // Nothing sits above the first item to nest under, so the unit applies.
  const state = stateOf('1. o‸ne');
  assert.equal(applied(state, indentListSpec(state)), '  1. o‸ne');
});

await test('indent declines outside a list, so Tab stays free', () => {
  const state = stateOf('plain text‸');
  assert.equal(indentListSpec(state), null);
  assert.equal(outdentListSpec(state), null);
  assert.ok(!inListItem(state));
  assert.ok(inListItem(stateOf('- item‸')));
});

await test('Enter continues a bullet list', () => {
  const state = stateOf('- one‸');
  assert.equal(applied(state, continueBlockSpec(state)), '- one\n- ‸');
});

await test('Enter continues an ordered list with the next number', () => {
  const state = stateOf('1. one\n2. two‸');
  assert.equal(
    applied(state, continueBlockSpec(state)),
    '1. one\n2. two\n3. ‸',
  );
});

await test('Enter continues a task list with an empty box', () => {
  const state = stateOf('- [x] one‸');
  assert.equal(applied(state, continueBlockSpec(state)), '- [x] one\n- [ ] ‸');
});

await test('Enter on an empty list item ends the list', () => {
  const state = stateOf('- one\n- ‸');
  assert.equal(applied(state, continueBlockSpec(state)), '- one\n‸');
});

await test('Enter continues and then ends a block quote', () => {
  const quoted = stateOf('> one‸');
  assert.equal(applied(quoted, continueBlockSpec(quoted)), '> one\n> ‸');
  const empty = stateOf('> one\n> ‸');
  assert.equal(applied(empty, continueBlockSpec(empty)), '> one\n‸');
});

await test('Enter inside a code fence keeps the fence and adds no marker', () => {
  const state = stateOf('```\n- one‸\n```\n');
  assert.equal(continueBlockSpec(state), null);
  assert.ok(insideCodeFence(state, 2));
  assert.ok(!insideCodeFence(state, 4));
});

await test('a closed fence does not swallow the text after it', () => {
  const state = stateOf('```js\ncode\n```\n\n- one‸');
  assert.ok(!insideCodeFence(state, 6));
  assert.equal(
    applied(state, continueBlockSpec(state)),
    '```js\ncode\n```\n\n- one\n- ‸',
  );
});

await test('Shift and Enter breaks the line inside the paragraph', () => {
  // Record 0070. The backslash is the CommonMark break, so the renderer and
  // the preview both keep the break without starting a paragraph.
  const state = stateOf('One line.‸Joined to it.');
  assert.equal(
    applied(state, hardBreakSpec(state)),
    'One line.\\\n‸Joined to it.',
  );
});

await test('a break inside a list item stays inside the item', () => {
  const state = stateOf('- [ ] one‸');
  assert.equal(applied(state, hardBreakSpec(state)), '- [ ] one\\\n      ‸');
  const ordered = stateOf('  2. one‸');
  assert.equal(applied(ordered, hardBreakSpec(ordered)), '  2. one\\\n     ‸');
});

await test('a break inside a block quote repeats the quote marks', () => {
  const state = stateOf('> one‸');
  assert.equal(applied(state, hardBreakSpec(state)), '> one\\\n> ‸');
});

await test('a break replaces the selected text', () => {
  const state = stateOf('One «and two»three.');
  assert.equal(applied(state, hardBreakSpec(state)), 'One \\\n‸three.');
});

await test('a break declines inside a code fence', () => {
  const state = stateOf('```\ncode‸\n```\n');
  assert.equal(hardBreakSpec(state), null);
});

await test('the list line parser reads every marker shape', () => {
  assert.equal(parseListLine('plain'), null);
  const ordered = parseListLine('  3) text');
  assert.equal(ordered?.kind, 'ordered');
  assert.equal(ordered?.value, 3);
  assert.equal(ordered?.prefixLength, 5);
  const task = parseListLine('- [ ] text');
  assert.equal(task?.task, '[ ] ');
  assert.equal(task?.prefixLength, 6);
});

await test('every documented shortcut has a binding or a window handler', () => {
  const keys = new Set(formattingKeymap.map((binding) => binding.key));
  for (const wanted of [
    'Mod-b',
    'Mod-i',
    'Mod-e',
    'Mod-k',
    'Mod-Shift-x',
    'Mod-1',
    'Mod-6',
    'Mod-Shift-7',
    'Mod-Shift-8',
    'Mod-Shift-9',
    'Mod-Shift-.',
    'Mod-]',
    'Mod-[',
    'Tab',
    'Enter',
    'Shift-Enter',
  ])
    assert.ok(keys.has(wanted), `missing binding ${wanted}`);
  assert.ok(shortcuts.length >= 15);
  for (const row of shortcuts) {
    assert.notEqual(row.keys, '');
    assert.notEqual(row.description, '');
  }
});

await test('the link and command palette use separate shortcuts', () => {
  assert.deepEqual(
    shortcuts.filter(
      (shortcut) =>
        shortcut.keys === 'Cmd or Ctrl + K' ||
        shortcut.keys === 'Cmd or Ctrl + P',
    ),
    [
      {
        keys: 'Cmd or Ctrl + K',
        description: 'Insert a link in the note',
      },
      {
        keys: 'Cmd or Ctrl + P',
        description: 'Open the command palette',
      },
    ],
  );
});

/**
 * What each format action writes, with an empty and a filled selection.
 *
 * The rows name the pure spec that the command of the action dispatches. The
 * test below also proves that the table covers every action, so a new action
 * cannot ship without its two cases.
 */
const formatCases: Readonly<
  Record<
    FormatActionId,
    {
      readonly spec: (state: EditorState) => TransactionSpec | null;
      readonly empty: readonly [string, string];
      readonly filled: readonly [string, string];
    }
  >
> = {
  'heading-1': {
    spec: (state) => headingLevelSpec(state, 1),
    empty: ['‸', '# ‸'],
    filled: ['«Title»', '# «Title»'],
  },
  'heading-2': {
    spec: (state) => headingLevelSpec(state, 2),
    empty: ['‸', '## ‸'],
    filled: ['«Title»', '## «Title»'],
  },
  'heading-3': {
    spec: (state) => headingLevelSpec(state, 3),
    empty: ['‸', '### ‸'],
    filled: ['«Title»', '### «Title»'],
  },
  'heading-4': {
    spec: (state) => headingLevelSpec(state, 4),
    empty: ['‸', '#### ‸'],
    filled: ['«Title»', '#### «Title»'],
  },
  'heading-5': {
    spec: (state) => headingLevelSpec(state, 5),
    empty: ['‸', '##### ‸'],
    filled: ['«Title»', '##### «Title»'],
  },
  'heading-6': {
    spec: (state) => headingLevelSpec(state, 6),
    empty: ['‸', '###### ‸'],
    filled: ['«Title»', '###### «Title»'],
  },
  bold: {
    spec: (state) => toggleInlineSpec(state, '**'),
    empty: ['say ‸', 'say **‸**'],
    filled: ['say «hi»', 'say **«hi»**'],
  },
  italic: {
    spec: (state) => toggleInlineSpec(state, '*'),
    empty: ['say ‸', 'say *‸*'],
    filled: ['say «hi»', 'say *«hi»*'],
  },
  strikethrough: {
    spec: (state) => toggleInlineSpec(state, '~~'),
    empty: ['say ‸', 'say ~~‸~~'],
    filled: ['say «hi»', 'say ~~«hi»~~'],
  },
  'inline-code': {
    spec: (state) => toggleInlineSpec(state, '`'),
    empty: ['say ‸', 'say `‸`'],
    filled: ['say «hi»', 'say `«hi»`'],
  },
  link: {
    spec: (state) => linkSpec(state),
    empty: ['see ‸', 'see [](‸)'],
    filled: ['see «docs»', 'see [docs](‸)'],
  },
  'bullet-list': {
    spec: (state) => toggleListSpec(state, 'bullet'),
    empty: ['‸', '- ‸'],
    filled: ['«one\ntwo»', '- «one\n- two»'],
  },
  'ordered-list': {
    spec: (state) => toggleListSpec(state, 'ordered'),
    empty: ['‸', '1. ‸'],
    filled: ['«one\ntwo»', '1. «one\n2. two»'],
  },
  'task-list': {
    spec: (state) => toggleListSpec(state, 'task'),
    empty: ['‸', '- [ ] ‸'],
    filled: ['«one\ntwo»', '- [ ] «one\n- [ ] two»'],
  },
  quote: {
    spec: toggleQuoteSpec,
    empty: ['‸', '> ‸'],
    filled: ['«one\ntwo»', '> «one\n> two»'],
  },
  table: {
    spec: tableSpec,
    // A table at the end of the note gets a line to leave it for.
    empty: [
      '‸',
      '| «Column 1» | Column 2 |\n| -------- | -------- |\n|          |          |\n\n',
    ],
    filled: [
      '«Name»',
      '| Name | «Column 2» |\n| ---- | -------- |\n|      |          |\n\n',
    ],
  },
  'table-row-above': {
    spec: (state) => tableEditSpec(state, insertRowAboveEdit),
    empty: [
      '| a   | b   |\n| --- | --- |\n| 1‸   | 2   |',
      '| a   | b   |\n| --- | --- |\n| ‸    |     |\n| 1   | 2   |',
    ],
    filled: [
      '| a   | b   |\n| --- | --- |\n| «1»   | 2   |',
      '| a   | b   |\n| --- | --- |\n| ‸    |     |\n| 1   | 2   |',
    ],
  },
  'table-row-below': {
    spec: (state) => tableEditSpec(state, addRowEdit),
    empty: [
      '| a   | b   |\n| --- | --- |\n| 1‸   | 2   |',
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| ‸    |     |',
    ],
    filled: [
      '| a   | b   |\n| --- | --- |\n| «1»   | 2   |',
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| ‸    |     |',
    ],
  },
  'table-column-left': {
    spec: (state) => tableEditSpec(state, insertColumnLeftEdit),
    empty: [
      '| a‸   | b   |\n| --- | --- |\n| 1   | 2   |',
      '| ‸    | a   | b   |\n| --- | --- | --- |\n|     | 1   | 2   |',
    ],
    filled: [
      '| «a»   | b   |\n| --- | --- |\n| 1   | 2   |',
      '| ‸    | a   | b   |\n| --- | --- | --- |\n|     | 1   | 2   |',
    ],
  },
  'table-column-right': {
    spec: (state) => tableEditSpec(state, addColumnEdit),
    empty: [
      '| a‸   | b   |\n| --- | --- |\n| 1   | 2   |',
      '| a   | ‸    | b   |\n| --- | --- | --- |\n| 1   |     | 2   |',
    ],
    filled: [
      '| «a»   | b   |\n| --- | --- |\n| 1   | 2   |',
      '| a   | ‸    | b   |\n| --- | --- | --- |\n| 1   |     | 2   |',
    ],
  },
  'table-move-row-up': {
    spec: (state) => tableEditSpec(state, moveRowUpEdit),
    empty: [
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| 3‸   | 4   |',
      '| a   | b   |\n| --- | --- |\n| 3‸   | 4   |\n| 1   | 2   |',
    ],
    filled: [
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| «3»   | 4   |',
      '| a   | b   |\n| --- | --- |\n| 3‸   | 4   |\n| 1   | 2   |',
    ],
  },
  'table-move-row-down': {
    spec: (state) => tableEditSpec(state, moveRowDownEdit),
    empty: [
      '| a   | b   |\n| --- | --- |\n| 1‸   | 2   |\n| 3   | 4   |',
      '| a   | b   |\n| --- | --- |\n| 3   | 4   |\n| 1‸   | 2   |',
    ],
    filled: [
      '| a   | b   |\n| --- | --- |\n| «1»   | 2   |\n| 3   | 4   |',
      '| a   | b   |\n| --- | --- |\n| 3   | 4   |\n| 1‸   | 2   |',
    ],
  },
  'table-move-column-left': {
    spec: (state) => tableEditSpec(state, moveColumnLeftEdit),
    empty: [
      '| a   | b‸   |\n| --- | --- |\n| 1   | 2   |',
      '| b‸   | a   |\n| --- | --- |\n| 2   | 1   |',
    ],
    filled: [
      '| a   | «b»   |\n| --- | --- |\n| 1   | 2   |',
      '| b‸   | a   |\n| --- | --- |\n| 2   | 1   |',
    ],
  },
  'table-move-column-right': {
    spec: (state) => tableEditSpec(state, moveColumnRightEdit),
    empty: [
      '| a‸   | b   |\n| --- | --- |\n| 1   | 2   |',
      '| b   | a‸   |\n| --- | --- |\n| 2   | 1   |',
    ],
    filled: [
      '| «a»   | b   |\n| --- | --- |\n| 1   | 2   |',
      '| b   | a‸   |\n| --- | --- |\n| 2   | 1   |',
    ],
  },
  'table-delete-row': {
    spec: (state) => tableEditSpec(state, removeRowEdit),
    empty: [
      '| a   | b   |\n| --- | --- |\n| 1‸   | 2   |',
      '| a‸   | b   |\n| --- | --- |',
    ],
    filled: [
      '| a   | b   |\n| --- | --- |\n| «1»   | 2   |',
      '| a‸   | b   |\n| --- | --- |',
    ],
  },
  'table-delete-column': {
    spec: (state) => tableEditSpec(state, removeColumnEdit),
    empty: [
      '| a   | b‸   |\n| --- | --- |\n| 1   | 2   |',
      '| a‸   |\n| --- |\n| 1   |',
    ],
    filled: [
      '| a   | «b»   |\n| --- | --- |\n| 1   | 2   |',
      '| a‸   |\n| --- |\n| 1   |',
    ],
  },
  'table-delete': {
    spec: (state) => deleteTableSpec(state),
    empty: ['| a   | b‸   |\n| --- | --- |\n| 1   | 2   |', '‸'],
    filled: ['| a   | «b»   |\n| --- | --- |\n| 1   | 2   |', '‸'],
  },
  'table-align-left': {
    spec: (state) => tableEditSpec(state, alignColumnEdit('left')),
    empty: [
      '| a   | b‸   |\n| --- | --- |\n| 1   | 2   |',
      '| a   | b‸   |\n| --- | :-- |\n| 1   | 2   |',
    ],
    filled: [
      '| a   | «b»   |\n| --- | --- |\n| 1   | 2   |',
      '| a   | b‸   |\n| --- | :-- |\n| 1   | 2   |',
    ],
  },
  'table-align-center': {
    spec: (state) => tableEditSpec(state, alignColumnEdit('center')),
    empty: [
      '| a   | b‸   |\n| --- | --- |\n| 1   | 2   |',
      '| a   | b‸   |\n| --- | :-: |\n| 1   | 2   |',
    ],
    filled: [
      '| a   | «b»   |\n| --- | --- |\n| 1   | 2   |',
      '| a   | b‸   |\n| --- | :-: |\n| 1   | 2   |',
    ],
  },
  'table-align-right': {
    spec: (state) => tableEditSpec(state, alignColumnEdit('right')),
    empty: [
      '| a   | b‸   |\n| --- | --- |\n| 1   | 2   |',
      '| a   | b‸   |\n| --- | --: |\n| 1   | 2   |',
    ],
    filled: [
      '| a   | «b»   |\n| --- | --- |\n| 1   | 2   |',
      '| a   | b‸   |\n| --- | --: |\n| 1   | 2   |',
    ],
  },
};

await test('every format action writes its shape for both selections', () => {
  assert.deepEqual(
    formatActions.map((action) => action.id).sort(),
    Object.keys(formatCases).sort(),
  );
  for (const action of formatActions) {
    const cases = formatCases[action.id];
    for (const [source, expected] of [cases.empty, cases.filled]) {
      const state = stateOf(source);
      assert.equal(applied(state, cases.spec(state)), expected, action.id);
    }
  }
});

await test('a tool runs the command that its key runs', () => {
  // The toolbar and the palette run `command` of a format action, and the
  // keymap is built from the same table, so both roads reach one function.
  for (const action of formatActions) {
    if (action.key === null) continue;
    const bindings = formattingKeymap.filter(
      (binding) => binding.key === action.key,
    );
    assert.equal(bindings.length, 1, `${action.key} is bound once`);
    assert.equal(bindings[0]?.run, action.command, action.id);
  }
  assert.equal(formatActionOf('bold').key, 'Mod-b');
  assert.equal(
    formattingKeymap.find((binding) => binding.key === 'Mod-k')
      ?.stopPropagation,
    true,
  );
});

await test('the shortcut table names the key of every format action', () => {
  const documented = new Set(shortcuts.map((row) => row.keys));
  for (const action of formatActions) {
    if (action.keys === null) continue;
    const heading = action.id.startsWith('heading-');
    assert.ok(
      documented.has(heading ? 'Cmd or Ctrl + 1 to 6' : action.keys),
      `the shortcut table lacks ${action.keys}`,
    );
  }
});

await test('a key line reads the way the shortcut table writes it', () => {
  assert.equal(shortcutKeys('Mod-b'), 'Cmd or Ctrl + B');
  assert.equal(shortcutKeys('Mod-Shift-x'), 'Cmd or Ctrl + Shift + X');
  assert.equal(shortcutKeys('Mod-Shift-.'), 'Cmd or Ctrl + Shift + .');
  assert.equal(shortcutKeys('Mod-3'), 'Cmd or Ctrl + 3');
});

await test('a table stands on its own lines between blank lines', () => {
  const table =
    '| Column 1 | Column 2 |\n| -------- | -------- |\n|          |          |';
  const selected = table.replace('Column 1', '«Column 1»');
  const below = stateOf('Intro\n‸\nMore');
  assert.equal(
    applied(below, tableSpec(below)),
    `Intro\n\n${selected}\n\nMore`,
  );
  const inline = stateOf('Intro ‸text');
  assert.equal(
    applied(inline, tableSpec(inline)),
    `Intro\n\n${selected}\n\ntext`,
  );
  const blank = stateOf('Intro\n\n‸\n\nMore');
  assert.equal(
    applied(blank, tableSpec(blank)),
    `Intro\n\n${selected}\n\nMore`,
  );
});

await test('a selection becomes one header cell with its pipes escaped', () => {
  const state = stateOf('«a | b\nc»');
  assert.equal(
    applied(state, tableSpec(state)),
    '| a \\| b c | «Column 2» |\n| -------- | -------- |\n|          |          |\n\n',
  );
});

await test('a table declines inside a code fence', () => {
  const state = stateOf('```\n‸\n```');
  assert.equal(tableSpec(state), null);
});

await test('the block commands leave a table alone', () => {
  // A marker at the start of a table line would end the table (record 0095).
  const state = stateOf('| a   | b‸   |\n| --- | --- |\n| 1   | 2   |');
  assert.equal(headingLevelSpec(state, 2), null);
  assert.equal(toggleListSpec(state, 'bullet'), null);
  assert.equal(toggleQuoteSpec(state), null);
  assert.equal(tableSpec(state), null);
  assert.equal(hardBreakSpec(state), null);
});

await test('Arrow Down opens a line under a table that ends the note', () => {
  // The caret stays in the cells, so the note needs a line to leave for, and
  // a blank line ends the table in GFM.
  const last = stateOf('| a   |\n| --- |\n| 1‸   |');
  assert.equal(
    applied(last, leaveTableBelowSpec(last)),
    '| a   |\n| --- |\n| 1   |\n\n‸',
  );
  const header = stateOf('| a‸   |\n| --- |\n| 1   |');
  assert.equal(leaveTableBelowSpec(header), null);
  const followed = stateOf('| a   |\n| --- |\n| 1‸   |\n\nText');
  assert.equal(leaveTableBelowSpec(followed), null);
});

await test('Delete table removes the table and one blank line beside it', () => {
  const table = '| a   | b   |\n| --- | --- |\n| 1‸   | 2   |';
  for (const [source, expected] of [
    [`Before\n\n${table}\n\nAfter`, 'Before\n\n‸After'],
    [`${table}\n\nAfter`, '‸After'],
    [`Before\n\n${table}`, 'Before‸'],
  ] as const)
    assert.equal(
      applied(stateOf(source), deleteTableSpec(stateOf(source))),
      expected,
      source,
    );
  assert.equal(deleteTableSpec(stateOf('No table‸ here')), null);
});
