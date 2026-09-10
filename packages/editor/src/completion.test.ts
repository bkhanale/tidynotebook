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
  markdownDestination,
  noteDisplayName,
  noteFolder,
  noteLinkCompletion,
  noteLinkSource,
  noteLinkText,
  relativeNotePath,
  type NoteLinkSource,
} from './completion.ts';

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

await test('a relative path steps out of the shared folder', () => {
  assert.equal(
    relativeNotePath('projects/alpha.md', 'inbox.md'),
    '../inbox.md',
  );
  assert.equal(
    relativeNotePath('projects/alpha.md', 'projects/beta.md'),
    'beta.md',
  );
  assert.equal(
    relativeNotePath('inbox.md', 'archive/2024/old.md'),
    'archive/2024/old.md',
  );
  assert.equal(relativeNotePath('a/b/c.md', 'a/x/y.md'), '../x/y.md');
});

await test('the display name drops the folder and the suffix', () => {
  assert.equal(noteDisplayName('archive/2024/old note.md'), 'old note');
  assert.equal(noteFolder('archive/2024/old note.md'), 'archive/2024');
  assert.equal(noteFolder('inbox.md'), '');
});

await test('a destination escapes the characters that would end it', () => {
  assert.equal(markdownDestination('beta plan.md'), 'beta%20plan.md');
  assert.equal(markdownDestination('a(b).md'), 'a%28b%29.md');
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
