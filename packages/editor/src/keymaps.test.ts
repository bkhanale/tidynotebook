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
import {
  continueBlockSpec,
  formattingKeymap,
  hardBreakSpec,
  headingLevelSpec,
  indentListSpec,
  inListItem,
  insideCodeFence,
  isLinkDestination,
  linkSpec,
  outdentListSpec,
  parseListLine,
  shortcuts,
  toggleInlineSpec,
  toggleListSpec,
  toggleQuoteSpec,
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
    });
  }
  const cursor = source.indexOf('‸');
  assert.notEqual(cursor, -1, 'the source needs a cursor or a range');
  return EditorState.create({
    doc: source.replace('‸', ''),
    selection: { anchor: cursor },
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

await test('a URL from the clipboard becomes the destination', () => {
  const state = stateOf('see «the page» now');
  assert.equal(
    applied(state, linkSpec(state, 'https://example.com/page')),
    'see [the page](https://example.com/page)‸ now',
  );
});

await test('a clipboard value that is not a URL is ignored', () => {
  const state = stateOf('see «the page» now');
  assert.equal(
    applied(state, linkSpec(state, 'not a url')),
    'see [the page](‸) now',
  );
  assert.ok(!isLinkDestination('not a url'));
  assert.ok(isLinkDestination('https://example.com'));
  assert.ok(isLinkDestination('mailto:someone@example.com'));
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
