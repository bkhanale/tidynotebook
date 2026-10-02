/**
 * The find and replace panel (issue 247): its words and its keys.
 *
 * The panel itself is DOM, which a test of this package cannot build, so the
 * browser run shows it. These tests hold what a person reads and the keys.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { gotoLine, searchKeymap } from '@codemirror/search';
import {
  editorPhrases,
  noteSearchKeymap,
  searchPanelWords,
} from './search-panel.ts';

/** Whether a text is in sentence case: one capital at its start. */
function sentenceCase(text: string): boolean {
  const first = text.charAt(0);
  return (
    first === first.toUpperCase() &&
    text.slice(1) === text.slice(1).toLowerCase()
  );
}

await test('every word of the panel is in sentence case', () => {
  // The panel of the package said next, regexp and by word.
  for (const words of Object.values(searchPanelWords))
    assert.ok(sentenceCase(words), words);
  for (const [phrase, words] of Object.entries(editorPhrases))
    assert.ok(
      sentenceCase(words) || words === words.toLowerCase(),
      `${phrase}: ${words}`,
    );
});

await test('the panel keeps every key of the package but the line dialog', () => {
  assert.equal(noteSearchKeymap.length, searchKeymap.length - 1);
  assert.ok(!noteSearchKeymap.some((binding) => binding.run === gotoLine));
  // Escape closes the panel and F3 finds the next match, as before.
  assert.ok(noteSearchKeymap.some((binding) => binding.key === 'Escape'));
  assert.ok(noteSearchKeymap.some((binding) => binding.key === 'F3'));
});
