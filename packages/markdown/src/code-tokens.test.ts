/**
 * The one map from a Lezer tag to a code token (record 0159).
 *
 * The editor builds its highlight style from this map and the renderer its
 * classes, so the boundary rules of the code colours are held here once.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { tags, type Tag } from '@lezer/highlight';
import {
  codeTokenClass,
  codeTokenClasses,
  codeTokenNames,
  codeTokenTags,
} from './code-tokens.ts';

/** Every tag that the map colours, flattened. */
function mappedTags(): readonly Tag[] {
  return codeTokenTags.flatMap((entry) => entry.tags);
}

await test('the map never colours a Markdown construct', () => {
  for (const markdownTag of [
    tags.heading,
    tags.strong,
    tags.emphasis,
    tags.link,
    tags.url,
  ])
    assert.ok(!mappedTags().includes(markdownTag));
});

await test('the map never colours a marker of a note', () => {
  // Every marker of a note carries `tags.processingInstruction`, a child of
  // `tags.meta`, and a highlighter paints a child through its parent.
  for (const markerTag of [tags.meta, tags.processingInstruction])
    assert.ok(!mappedTags().includes(markerTag));
});

await test('the map colours the code constructs', () => {
  for (const codeTag of [
    tags.keyword,
    tags.string,
    tags.comment,
    tags.number,
    tags.invalid,
  ])
    assert.ok(mappedTags().includes(codeTag));
});

await test('each token has one entry and one class', () => {
  assert.deepEqual(
    codeTokenTags.map((entry) => entry.token),
    [...codeTokenNames],
  );
  assert.deepEqual(codeTokenClasses, codeTokenNames.map(codeTokenClass));
  assert.equal(codeTokenClass('keyword'), 'notes-code-keyword');
});
