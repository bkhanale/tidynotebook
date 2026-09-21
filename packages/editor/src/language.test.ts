/**
 * The code highlight style must never colour a Markdown construct.
 *
 * A heading, strong text, emphasis, and a link belong to the note typography,
 * which the live preview decorations style. If the fenced-code highlight style
 * also carried those tags, it would repaint the Markdown heading, the bold
 * run, and the link with the code palette, so the note text would take a code
 * colour. This test holds the boundary.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { tags, type Tag } from '@lezer/highlight';
import {
  codeHighlightSpecs,
  noteMarkdown,
  parsedWhole,
  syntaxTokenNames,
} from './language.ts';

/** Every tag the code highlight style paints, flattened. */
function styledTags(): readonly Tag[] {
  return codeHighlightSpecs.flatMap((spec) =>
    Array.isArray(spec.tag) ? spec.tag : [spec.tag],
  );
}

await test('the code style never paints a Markdown construct', () => {
  const painted = styledTags();
  for (const markdownTag of [
    tags.heading,
    tags.strong,
    tags.emphasis,
    tags.link,
    tags.url,
  ])
    assert.ok(
      !painted.includes(markdownTag),
      'the code highlight style must not carry a Markdown tag',
    );
});

await test('the code style never paints a marker of a note', () => {
  // Every marker of a note carries `tags.processingInstruction`, which
  // `@lezer/highlight` defines as a child of `tags.meta`, and a highlight
  // style paints a child through its parent. One entry for the meta token of
  // a language therefore painted the list mark, the quote mark and the table
  // separator of every note, in a span inside the decoration that styles
  // them, so no rule of the theme adapter could take the colour back.
  const painted = styledTags();
  for (const markerTag of [tags.meta, tags.processingInstruction])
    assert.ok(
      !painted.includes(markerTag),
      'the code highlight style must not carry a marker tag',
    );
});

await test('the code style still paints the code constructs', () => {
  const painted = styledTags();
  for (const codeTag of [
    tags.keyword,
    tags.string,
    tags.comment,
    tags.number,
    tags.invalid,
  ])
    assert.ok(
      painted.includes(codeTag),
      'the code highlight style is complete',
    );
});

await test('the syntax contract keeps the heading and link names', () => {
  // The names stay in the shared contract with the theme registry even though
  // the code style no longer reads them, so the agreement test still holds.
  assert.ok(syntaxTokenNames.includes('heading'));
  assert.ok(syntaxTokenNames.includes('link'));
});

/**
 * Many short paragraphs, each its own block, well past the 3000 character
 * initial viewport of `@codemirror/language`.
 *
 * A single unbroken paragraph of the same length would not prove the
 * refusal: the incremental parser must finish a block it has already
 * started, so one giant paragraph parses to its end in the first pass
 * regardless of length. Many short blocks give the parser a boundary to
 * stop at inside the first 3000 characters, so the first pass is provably
 * partial.
 */
function manyShortParagraphs(count: number): string {
  return `${'word '.repeat(10)}\n\n`.repeat(count);
}

await test('parsedWhole pumps the parser until the tree covers the document', () => {
  const doc = manyShortParagraphs(60);
  const state = parsedWhole(
    EditorState.create({ doc, extensions: [noteMarkdown()] }),
  );
  assert.equal(syntaxTree(state).length, state.doc.length);
});

await test('parsedWhole refuses a document the bound cannot cover', () => {
  const doc = manyShortParagraphs(60);
  const fresh = EditorState.create({ doc, extensions: [noteMarkdown()] });
  // A fresh state only ever parses its initial viewport, capped at 3000
  // characters, so a document past that length is partial before the first
  // pump. An attempt bound of 0 forces the refusal without depending on how
  // fast the machine running the test is.
  assert.ok(syntaxTree(fresh).length < fresh.doc.length);
  assert.throws(
    () => parsedWhole(fresh, { attempts: 0 }),
    /the parser stopped at \d+ of \d+ characters/,
  );
});
