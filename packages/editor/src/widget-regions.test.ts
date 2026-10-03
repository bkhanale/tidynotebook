/**
 * Checks the region index of the widget field: an edit reads only the blocks
 * that it changed, and the index always equals a scan of the whole note.
 *
 * A key on a long note walked the whole syntax tree five times, once for each
 * kind of region, and again for each paragraph. At four times less CPU a key
 * on a note of 500 KB then took longer than the next key took to arrive.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { syntaxTree } from '@codemirror/language';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { noteMarkdown, parsedWhole } from './language.ts';
import { regionIndex, regionIndexOf, richWidgets } from './widgets.ts';

const attachment = '/attachments/0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

/** A note with every kind of region, many times over. */
function longNote(sections: number): string {
  const parts = ['# Long note', ''];
  for (let index = 0; index < sections; index += 1)
    parts.push(
      `## Part ${String(index)}`,
      '',
      `The plan for week ${String(index)} has one owner who writes  `,
      'and keeps a hard break in this paragraph.',
      '',
      `- an item with $x_${String(index)}$ in it`,
      '- [ ] a task of the week',
      `- See [the first note](../note-${String(index)}.md)`,
      '',
      index % 7 === 0 ? `![shot](${attachment})` : 'A line of text.',
      '',
      index % 11 === 0 ? '```js\nconst week = 1;\n```' : 'Another line.',
      '',
      index % 13 === 0 ? 'Setext title\n===' : 'Last line.',
      '',
    );
  return `${parts.join('\n')}\n`;
}

/** A parsed state of one note with the widget field. */
function opened(doc: string): {
  readonly state: EditorState;
  readonly extension: ReturnType<typeof richWidgets>;
} {
  const extension = richWidgets();
  return {
    extension,
    state: parsedWhole(
      EditorState.create({ doc, extensions: [noteMarkdown(), extension] }),
    ),
  };
}

/** Applies one edit and lets the parser finish the note. */
function edit(state: EditorState, spec: TransactionSpec): EditorState {
  return settled(state.update(spec).state);
}

/** Whether the Markdown body of a tree reaches the end of its note. */
function bodyWhole(state: EditorState): boolean {
  const top = syntaxTree(state).topNode;
  for (let child = top.firstChild; child !== null; child = child.nextSibling)
    if (child.name === 'Document') return child.to >= state.doc.length;
  return true;
}

/**
 * The state after its parse ends.
 *
 * Under load the parse of the body can stop part way while the tree already
 * spans the note, and CodeMirror then parses no more until the next edit. A
 * key and its removal at the end stand for that next edit, as the next key
 * of a person does.
 */
function settled(state: EditorState): EditorState {
  let current = parsedWhole(state);
  for (let attempt = 0; attempt < 5 && !bodyWhole(current); attempt += 1) {
    const end = current.doc.length;
    current = parsedWhole(
      current.update({ changes: { from: end, insert: ' ' } }).state,
    );
    current = parsedWhole(
      current.update({ changes: { from: end, to: end + 1 } }).state,
    );
  }
  return current;
}

/** The regions of the field, as plain data. */
function regionsOf(
  state: EditorState,
  extension: ReturnType<typeof richWidgets>,
): unknown {
  return regionIndex(state, extension)?.regions;
}

await test('a key in a long note reads only the blocks around it', () => {
  const { state, extension } = opened(longNote(400));
  const whole = regionIndexOf(state).visited;
  let current = state;
  for (const position of [
    current.doc.length - 1,
    Math.floor(current.doc.length / 2),
    40,
  ]) {
    const line = current.doc.lineAt(position);
    current = current.update({
      changes: { from: line.to, insert: 'k' },
    }).state;
    const index = regionIndex(current, extension);
    assert.ok(index !== null);
    assert.ok(
      index.visited < 120,
      `a key entered ${String(index.visited)} of ${String(whole)} nodes`,
    );
  }
  assert.ok(whole > 10_000, `the note has ${String(whole)} nodes`);
});

await test('the index after each edit equals a scan of the whole note', () => {
  const { state, extension } = opened(longNote(40));
  let current = state;
  const edits: ((doc: string) => TransactionSpec)[] = [
    // A key in the text of a paragraph.
    (doc) => ({ changes: { from: doc.indexOf('owner') + 2, insert: 'x' } }),
    // An open fence, which turns the rest of the note into code.
    (doc) => ({ changes: { from: doc.indexOf('## Part 5'), insert: '```\n' } }),
    // The fence closes again further down.
    (doc) => ({ changes: { from: doc.indexOf('## Part 9'), insert: '```\n' } }),
    // A line break that ends a hard break paragraph.
    (doc) => ({ changes: { from: doc.indexOf('writes  ') + 8, insert: '\n' } }),
    // A setext underline that turns a paragraph into a heading.
    (doc) => ({
      changes: { from: doc.indexOf('A line of text.') + 15, insert: '\n---' },
    }),
    // A picture typed into a list item.
    (doc) => ({
      changes: { from: doc.indexOf('a task'), insert: `![a](${attachment}) ` },
    }),
    // A deletion across many blocks.
    (doc) => ({
      changes: {
        from: doc.indexOf('## Part 12'),
        to: doc.indexOf('## Part 20'),
      },
    }),
    // A link definition, which an image anywhere can name.
    (doc) => ({
      changes: { from: doc.length, insert: `\n[pic]: ${attachment}\n` },
    }),
    // An image that names it, before the definition.
    (doc) => ({
      changes: { from: doc.indexOf('Another line.'), insert: '![pic] ' },
    }),
    // The definition goes, and the image renders no widget any more.
    (doc) => ({
      changes: { from: doc.indexOf('[pic]:'), to: doc.length },
    }),
    // A deletion of the whole note.
    (doc) => ({ changes: { from: 0, to: doc.length, insert: '# New\n' } }),
  ];
  for (const [step, make] of edits.entries()) {
    current = edit(current, make(current.doc.toString()));
    assert.deepEqual(
      regionsOf(current, extension),
      regionIndexOf(current).regions,
      `edit ${String(step)}`,
    );
  }
});

await test('a parse that reaches further adds the regions of the new blocks', () => {
  const extension = richWidgets();
  // A state that has not parsed the note yet holds only part of its tree.
  let state = EditorState.create({
    doc: longNote(2000),
    extensions: [noteMarkdown(), extension],
  });
  state = parsedWhole(state);
  assert.deepEqual(regionsOf(state, extension), regionIndexOf(state).regions);
});

await test('random edits keep the index equal to a scan of the whole note', () => {
  for (const start of [7, 11, 23, 101, 977]) randomEdits(start, null, 300);
  // A note with front matter puts its Markdown body beside the front matter.
  randomEdits(31, null, 300, '---\ntitle: Plan\n---\n');
});

await test('an edit whose parse stops before the end keeps the index right', () => {
  // A slow device stops the parse of an edit before the end of the note,
  // and the tree it gives then holds none of the blocks of the note. The
  // field lost the regions of those blocks until the next edit near them.
  // The clock here runs fast inside each update, so the parse stops at a
  // place that depends on the step of the clock, as it does under load.
  for (const step of [0.13, 0.3, 1.3])
    for (const start of [7, 977]) randomEdits(start, step, 60);
});

/** Runs one update with a clock that moves `step` ms at each reading. */
function slowly<T>(step: number, run: () => T): T {
  const now = Date.now;
  let time = now();
  Date.now = () => {
    time += step;
    return time;
  };
  try {
    return run();
  } finally {
    Date.now = now;
  }
}

/**
 * Edits from one seed, each checked against a whole scan. With a clock step,
 * each edit runs on the slow clock, and some edits follow the last one
 * before its parse ends.
 */
function randomEdits(
  start: number,
  clock: number | null,
  steps: number,
  frontMatter = '',
): void {
  const { state, extension } = opened(`${frontMatter}${longNote(30)}`);
  // A fixed sequence, so a failure repeats.
  let seed = start;
  const next = (bound: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % bound;
  };
  const pieces = [
    'a',
    '\n',
    '\n\n',
    '```\n',
    '~~~mermaid\n',
    '$$\n',
    '$y$',
    `![p](${attachment})`,
    '  \n',
    '\n===\n',
    '> ',
    '- ',
    '1. ',
    '[^1]',
    '[q]: /attachments/x\n',
    '![q]',
    '<div>\n',
  ];
  let current = state;
  for (let step = 0; step < steps; step += 1) {
    const length = current.doc.length;
    const from = next(length + 1);
    const remove = next(4) === 0 ? Math.min(length - from, next(80)) : 0;
    const insert =
      remove > 0 && next(2) === 0 ? '' : (pieces[next(pieces.length)] ?? 'a');
    const spec = { changes: { from, to: from + remove, insert } };
    if (clock === null) current = edit(current, spec);
    else {
      const before = current;
      current = slowly(clock, () => before.update(spec).state);
      if (next(3) === 0) continue;
      current = settled(current);
    }
    assert.deepEqual(
      regionsOf(current, extension),
      regionIndexOf(current).regions,
      `seed ${String(start)} clock ${String(clock)} step ${String(step)}: ${JSON.stringify(insert)} at ${String(from)}, ${String(remove)} removed`,
    );
  }
}
