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
import { tags, type Tag } from '@lezer/highlight';
import { codeHighlightSpecs, syntaxTokenNames } from './language.ts';

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
