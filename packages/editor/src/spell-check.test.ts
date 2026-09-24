/**
 * The spell check of a note (record 0103).
 *
 * The ranges come from the real note language, so these tests build an
 * `EditorState` with it and read the ranges that stay out of the check. The
 * content attribute is data of the state until a view renders it, so no DOM
 * is needed either.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { noteMarkdown, parsedWhole } from './language.ts';
import { spellCheck, unspelledRanges } from './spell-check.ts';

function stateOf(doc: string): EditorState {
  return parsedWhole(EditorState.create({ doc, extensions: [noteMarkdown()] }));
}

/** The text of each range that the spell check skips in the whole note. */
function unspelledText(doc: string): readonly string[] {
  const state = stateOf(doc);
  return unspelledRanges(state, [{ from: 0, to: doc.length }]).map((range) =>
    state.sliceDoc(range.from, range.to),
  );
}

await test('prose stays in the check', () => {
  assert.deepEqual(
    unspelledText(
      [
        '# A heding',
        '',
        'Some *emphasis* and **strong** text with a tyop.',
        '',
        '- an item',
        '- [ ] a task',
        '',
        '| Name | Note |',
        '| ---- | ---- |',
        '| one  | two  |',
        '',
        '> A quote.',
      ].join('\n'),
    ),
    [],
  );
});

await test('code stays out of the check', () => {
  assert.deepEqual(
    unspelledText(
      [
        'Run `pnpm verfy` now.',
        '',
        '```ts',
        'const vaule = 1;',
        '```',
        '',
        '    indented cdoe',
      ].join('\n'),
    ),
    // The indent of a code block is layout, so its node starts after it.
    ['`pnpm verfy`', '```ts\nconst vaule = 1;\n```', 'indented cdoe'],
  );
});

await test('an address stays out and the text of a link stays in', () => {
  assert.deepEqual(
    unspelledText(
      [
        'Read [the gide](https://exmaple.com/pgae) and ![a pictre](img/phto.png).',
        '',
        'Open <https://exmaple.com> or www.exmaple.com.',
        '',
        'See [the rfc][rfc].',
        '',
        '[rfc]: https://exmaple.com/rfc "The titel"',
      ].join('\n'),
    ),
    [
      'https://exmaple.com/pgae',
      'img/phto.png',
      '<https://exmaple.com>',
      'www.exmaple.com',
      '[rfc]',
      '[rfc]',
      'https://exmaple.com/rfc',
    ],
  );
});

await test('HTML, front matter and math stay out of the check', () => {
  assert.deepEqual(
    unspelledText(
      [
        '---',
        'tittle: Draft',
        '---',
        'Press <kbd>Ctlr</kbd> &nbsp; now.',
        '',
        '<!-- a remindr -->',
        '',
        'Inline $$\\alpah$$ and \\(\\bta\\) math.',
        '',
        '$$',
        '\\sqrt{\\gamm}',
        '$$',
      ].join('\n'),
    ),
    [
      '---\ntittle: Draft\n---\n',
      '<kbd>',
      '</kbd>',
      '&nbsp;',
      '<!-- a remindr -->',
      '$$\\alpah$$',
      '\\(\\bta\\)',
      '$$\n\\sqrt{\\gamm}\n$$',
    ],
  );
});

await test('a node across two visible ranges is reported once', () => {
  const doc = 'Text\n\n```\nlong cdoe\nmore cdoe\n```\n';
  const state = stateOf(doc);
  const middle = doc.indexOf('more');
  const ranges = unspelledRanges(state, [
    { from: 0, to: middle },
    { from: middle, to: doc.length },
  ]);
  assert.deepEqual(ranges, [
    { from: doc.indexOf('```'), to: doc.lastIndexOf('```') + 3 },
  ]);
});

/** The `spellcheck` value that the content element takes from a state. */
function contentSpellcheck(state: EditorState): string | null {
  let value: string | null = null;
  for (const source of state.facet(EditorView.contentAttributes)) {
    if (typeof source === 'function') continue;
    const attribute = source['spellcheck'];
    if (attribute !== undefined) value ??= attribute;
  }
  return value;
}

await test('the setting states the attribute of the content element', () => {
  const on = EditorState.create({ extensions: [spellCheck(true)] });
  assert.equal(contentSpellcheck(on), 'true');
  // Off adds nothing, so the default of CodeMirror, which is off, holds.
  const off = EditorState.create({ extensions: [spellCheck(false)] });
  assert.equal(contentSpellcheck(off), null);
});
