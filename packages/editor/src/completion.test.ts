/**
 * Note link completion checks.
 *
 * The completion source reads only `EditorState`, so these tests build a
 * state with the injected note list and read the returned options. The
 * inserted text is asserted exactly, because that text is what lands in the
 * stored Markdown file.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import {
  noteDisplayName,
  noteFolder,
  noteLinkCompletion,
  noteLinkSource,
  noteLinkText,
  typedWikiLink,
  withNoteLinks,
  type NoteLinkSource,
} from './completion.ts';
import { noteMarkdown } from './language.ts';

/** The note list every test in this file uses. */
const source: NoteLinkSource = {
  currentPath: 'projects/alpha.md',
  notes: [
    { path: 'projects/alpha.md' },
    { path: 'projects/beta plan.md' },
    { path: 'archive/2024/old note.md' },
    { path: 'inbox.md' },
  ],
};

/** Runs the completion source over a document whose cursor is at `‸`. */
function complete(
  text: string,
  list: NoteLinkSource = source,
): CompletionResult | null {
  const position = text.indexOf('‸');
  assert.notEqual(position, -1, 'the source needs a cursor');
  const state = EditorState.create({
    doc: text.replace('‸', ''),
    selection: { anchor: position },
    extensions: [noteLinkSource(list)],
  });
  const result = noteLinkCompletion(
    new CompletionContext(state, position, false),
  );
  assert.ok(!(result instanceof Promise), 'the source answers immediately');
  return result;
}

await test('a link steps out of the shared folder of the open note', () => {
  assert.equal(noteLinkText(source, 'inbox.md'), '[inbox](../inbox.md)');
  assert.equal(
    noteLinkText(source, 'projects/beta plan.md'),
    '[beta plan](beta%20plan.md)',
  );
  assert.equal(
    noteLinkText({ notes: [], currentPath: 'a/b/c.md' }, 'a/x/y.md'),
    '[y](../x/y.md)',
  );
});

await test('the display name drops the folder and the suffix', () => {
  assert.equal(noteDisplayName('archive/2024/old note.md'), 'old note');
  assert.equal(noteFolder('archive/2024/old note.md'), 'archive/2024');
  assert.equal(noteFolder('inbox.md'), '');
});

await test('a link holds a name that a link would end', () => {
  // A `#` ended the destination at a fragment, and a bracket ended the label,
  // so the link reached no note (record 0172).
  assert.equal(
    noteLinkText(source, 'projects/C# [draft] (v2).md'),
    '[C# \\[draft\\] (v2)](C%23%20[draft]%20%28v2%29.md)',
  );
  assert.equal(
    noteLinkText(source, 'projects/Why? 100%.md'),
    '[Why? 100%](Why%3F%20100%25.md)',
  );
});

await test('typing the inline trigger offers the other notes', () => {
  const result = complete('See [beta](‸');
  assert.notEqual(result, null);
  assert.equal(result?.from, 11);
  const labels = result?.options.map((option) => option.label) ?? [];
  assert.deepEqual(labels.includes('alpha'), false);
  assert.ok(labels.includes('beta plan'));
  assert.ok(labels.includes('inbox'));
});

await test('the inline trigger inserts the destination and closes the link', () => {
  const result = complete('See [beta](‸');
  const option = result?.options.find((entry) => entry.label === 'beta plan');
  assert.equal(option?.apply, 'beta%20plan.md)');
  assert.equal(option?.detail, 'projects');
});

await test('an existing closing parenthesis is not repeated', () => {
  const result = complete('See [beta](‸)');
  const option = result?.options.find((entry) => entry.label === 'beta plan');
  assert.equal(option?.apply, 'beta%20plan.md');
});

await test('the typed text filters by name and by folder', () => {
  const byName = complete('See [x](be‸');
  assert.deepEqual(
    byName?.options.map((option) => option.label),
    ['beta plan'],
  );
  const byFolder = complete('See [x](archive‸');
  assert.deepEqual(
    byFolder?.options.map((option) => option.label),
    ['old note'],
  );
  assert.equal(complete('See [x](zzz‸'), null);
});

await test('the double bracket trigger inserts a standard link', () => {
  const result = complete('See [[be‸');
  assert.equal(result?.from, 4);
  assert.equal(result?.to, 8);
  const option = result?.options.find((entry) => entry.label === 'beta plan');
  assert.equal(option?.apply, '[beta plan](beta%20plan.md)');
  assert.ok(!String(option?.apply).includes('[['));
});

await test('the double bracket trigger takes the closing brackets after it', () => {
  // A person who typed `[[]]` and then the name between the brackets leaves
  // no bracket behind when they choose a note.
  assert.equal(complete('See [[be‸]] now')?.to, 10);
  assert.equal(complete('See [[be‸] now')?.to, 9);
  assert.equal(complete('See [[be‸ now')?.to, 8);
});

await test('the link text of one note is relative to the open note', () => {
  assert.equal(
    noteLinkText(source, 'archive/2024/old note.md'),
    '[old note](../archive/2024/old%20note.md)',
  );
});

await test('an empty note list offers nothing', () => {
  assert.equal(complete('See [x](‸', { notes: [], currentPath: 'a.md' }), null);
});

await test('plain text opens no completion', () => {
  assert.equal(complete('Just typing‸'), null);
});

/** A state of the note grammar, with the note list, at the caret `‸`. */
function noteState(text: string): { state: EditorState; at: number } {
  const at = text.indexOf('‸');
  return {
    state: EditorState.create({
      doc: text.replace('‸', ''),
      selection: { anchor: at },
      extensions: [noteMarkdown(), noteLinkSource(source)],
    }),
    at,
  };
}

await test('a typed last bracket turns a wiki link into a standard link', () => {
  // Record 0172. The note is there, so the wiki form becomes the link that
  // the list writes, and the typed text is replaced in one change.
  const typed = noteState('See [[beta plan]‸ now');
  assert.deepEqual(typedWikiLink(typed.state, typed.at), {
    from: 4,
    insert: '[beta plan](beta%20plan.md)',
  });
  const aliased = noteState('See [[../inbox|the inbox]‸');
  assert.deepEqual(typedWikiLink(aliased.state, aliased.at), {
    from: 4,
    insert: '[the inbox](../inbox.md)',
  });
});

await test('a typed last bracket keeps a wiki link that names no note', () => {
  for (const text of [
    'See [[nowhere]‸',
    'See \\[[beta plan]‸',
    'See `[[beta plan]‸`',
    '```\n[[beta plan]‸\n```',
    'See [beta plan]‸',
  ]) {
    const typed = noteState(text);
    assert.equal(typedWikiLink(typed.state, typed.at), null, text);
  }
});

await test('a paste of wiki links links the notes that are there', () => {
  const { state } = noteState('‸');
  assert.equal(
    withNoteLinks(
      state,
      'Read [[beta plan]], [[old note|the old one]] and [[gone]].',
    ),
    'Read [beta plan](beta%20plan.md), [the old one](../archive/2024/old%20note.md) and [[gone]].',
  );
  assert.equal(withNoteLinks(state, 'No links here.'), 'No links here.');
  const empty = EditorState.create({ doc: '' });
  assert.equal(withNoteLinks(empty, '[[beta plan]]'), '[[beta plan]]');
});

await test('a note name with a colon gives a link and never an address', () => {
  // Review of record 0172: `Meeting: Q3` gave a blocked link, and a note
  // named `https:evil.com` gave a link to another site.
  const colon: NoteLinkSource = {
    currentPath: 'a.md',
    notes: [
      { path: 'a.md' },
      { path: 'Meeting: Q3.md' },
      { path: 'https:evil.com.md' },
    ],
  };
  assert.equal(
    noteLinkText(colon, 'Meeting: Q3.md'),
    '[Meeting: Q3](Meeting%3A%20Q3.md)',
  );
  assert.equal(
    noteLinkText(colon, 'https:evil.com.md'),
    '[https:evil.com](https%3Aevil.com.md)',
  );
  const state = EditorState.create({
    doc: 'See [[Meeting: Q3]',
    selection: { anchor: 18 },
    extensions: [noteMarkdown(), noteLinkSource(colon)],
  });
  assert.deepEqual(typedWikiLink(state, 18), {
    from: 4,
    insert: '[Meeting: Q3](Meeting%3A%20Q3.md)',
  });
  assert.equal(
    withNoteLinks(state, '[[https:evil.com]]'),
    '[https:evil.com](https%3Aevil.com.md)',
  );
});
