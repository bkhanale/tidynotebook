/**
 * GFM footnotes in the editor grammar (record 0156).
 *
 * Each case parses a note with the note language and reads the footnote
 * nodes and the blocks around them, and the same note through remark, so the
 * two readers of a note find the same footnotes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { parseMarkdown } from '@notesapp/markdown';
import { noteMarkdown, parsedWhole } from './language.ts';

/** The nodes of a parsed note, with their text, in document order. */
function nodesOf(doc: string): readonly string[] {
  const state = parsedWhole(
    EditorState.create({ doc, extensions: [noteMarkdown()] }),
  );
  const found: string[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Document' || node.name === 'Body') return true;
      found.push(`${node.name}:${state.doc.sliceString(node.from, node.to)}`);
      return true;
    },
  });
  return found;
}

/** The names of the nodes of a note that start with `prefix`. */
function named(doc: string, prefix: string): readonly string[] {
  return nodesOf(doc).filter((entry) => entry.startsWith(prefix));
}

/** The mdast node types of a note, in document order. */
function remarkTypes(doc: string): readonly string[] {
  const text = JSON.stringify(parseMarkdown(doc));
  return [...text.matchAll(/"type":"([A-Za-z]+)"/g)].map(
    (match) => match[1] ?? '',
  );
}

await test('a definition is a footnote and not a link reference', () => {
  // The defect this covers: the definition parsed as a link reference, so the
  // editor showed its source while the published page showed a footnote.
  const doc = 'Text[^one].\n\n[^one]: The note with a [link](/notes/x).\n';
  // The blank line at the end of the note belongs to the definition, which
  // holds the blank lines it continues over.
  assert.deepEqual(named(doc, 'FootnoteDefinition'), [
    'FootnoteDefinition:[^one]: The note with a [link](/notes/x).\n',
  ]);
  assert.deepEqual(named(doc, 'LinkReference'), []);
  assert.deepEqual(named(doc, 'FootnoteReference'), [
    'FootnoteReference:[^one]',
  ]);
  assert.deepEqual(named(doc, 'FootnoteLabel'), [
    'FootnoteLabel:one',
    'FootnoteLabel:one',
  ]);
  assert.ok(remarkTypes(doc).includes('footnoteDefinition'));
  assert.ok(remarkTypes(doc).includes('footnoteReference'));
});

await test('a definition holds its indented lines and its lazy lines', () => {
  const doc =
    'Ref[^n]\n\n[^n]: First line\nlazy line\n\n    Second paragraph\n\nAfter\n';
  const definition = named(doc, 'FootnoteDefinition');
  assert.equal(definition.length, 1);
  assert.ok(definition[0]?.includes('Second paragraph'));
  assert.ok(!definition[0]?.includes('After'));
  // Both paragraphs are inside it, and the last line is outside it.
  assert.equal(named(doc, 'Paragraph').length, 4);
  const types = remarkTypes(doc);
  assert.equal(types.filter((type) => type === 'paragraph').length, 4);
});

await test('a definition ends the paragraph above it, as in remark', () => {
  const doc = 'A paragraph\n[^a]: The note\n\nRef[^a]\n';
  assert.deepEqual(named(doc, 'Paragraph:A'), ['Paragraph:A paragraph']);
  assert.equal(named(doc, 'FootnoteDefinition').length, 1);
  assert.deepEqual(remarkTypes(doc).slice(0, 3), ['root', 'paragraph', 'text']);
});

await test('a definition stands in a quote and in a list item', () => {
  const quoted = '> [^q]: In a quote\n\nRef[^q]\n';
  assert.equal(named(quoted, 'FootnoteDefinition').length, 1);
  const listed = '- [^l]: In a list\n\nRef[^l]\n';
  assert.equal(named(listed, 'FootnoteDefinition').length, 1);
});

await test('a definition covers the blank lines that it holds', () => {
  // A later parse reuses a block only when the line after it was read, so
  // the range of a definition must reach its last blank line (record 0155).
  const doc = '[^n]: First\n\n    Second\n\nAfter\n';
  assert.deepEqual(named(doc, 'FootnoteDefinition'), [
    'FootnoteDefinition:[^n]: First\n\n    Second\n',
  ]);
  assert.deepEqual(named(doc, 'FootnoteBlank'), [
    'FootnoteBlank:',
    'FootnoteBlank:',
  ]);
});

await test('only a label of the GFM rule makes a footnote', () => {
  for (const doc of [
    'Ref[^a b]\n\n[^a b]: no\n',
    'Ref[^]\n\n[^]: no\n',
    '    [^i]: indented code\n',
  ]) {
    assert.deepEqual(named(doc, 'FootnoteDefinition'), [], doc);
    assert.ok(!remarkTypes(doc).includes('footnoteDefinition'), doc);
  }
  // The label of a reference never crosses a line.
  assert.deepEqual(named('Ref[^a\nb]\n', 'FootnoteReference'), []);
});
