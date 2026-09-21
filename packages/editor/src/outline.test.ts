/**
 * Outline checks.
 *
 * The outline reads the same syntax tree as the preview, so a `#` inside a
 * fence is code here too. These tests exist because the old outline had its
 * own idea of what a heading is.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { noteMarkdown, parsedWhole } from './language.ts';
import { outlineOf } from './outline.ts';

/** Builds a state whose whole document is parsed. */
function stateOf(doc: string): EditorState {
  return parsedWhole(EditorState.create({ doc, extensions: [noteMarkdown()] }));
}

await test('every heading shape reaches the outline with its level', () => {
  const doc = '# One\n\n### Three\n\nSetext\n======\n\nOther\n------\n';
  assert.deepEqual(
    outlineOf(stateOf(doc)).map((row) => [row.level, row.text]),
    [
      [1, 'One'],
      [3, 'Three'],
      [1, 'Setext'],
      [2, 'Other'],
    ],
  );
});

await test('a hash inside a fence is code and not a heading', () => {
  const doc = '# Real\n\n```\n# Fake\n```\n\n    # Indented\n';
  assert.deepEqual(
    outlineOf(stateOf(doc)).map((row) => row.text),
    ['Real'],
  );
});

await test('a closing hash run is not part of the heading text', () => {
  assert.deepEqual(
    outlineOf(stateOf('## Title ##\n')).map((row) => row.text),
    ['Title'],
  );
});

await test('a row points at the start of its heading', () => {
  const doc = 'intro\n\n## Target\n';
  const [row] = outlineOf(stateOf(doc));
  assert.equal(row?.from, doc.indexOf('## Target'));
  assert.equal(doc.slice(row?.from, row?.to), '## Target');
});

await test('an empty heading has no row, because it cannot be read', () => {
  assert.deepEqual(outlineOf(stateOf('#\n\ntext\n')), []);
});

await test('a row shows the words a reader sees, not the markers', () => {
  assert.deepEqual(
    outlineOf(stateOf('# A **bold** `code` [link](/x) word\n')).map(
      (row) => row.text,
    ),
    ['A bold code link word'],
  );
});
