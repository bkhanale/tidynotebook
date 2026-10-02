/** The check mark of a task box, written and kept from one source. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeSchema } from './policy.ts';
import { renderMarkdown } from './render.ts';
import {
  taskMarkAttributes,
  taskMarkClass,
  taskMarkPoints,
} from './task-mark.ts';

await test('the renderer writes the attributes of the one check mark', async () => {
  const html = await renderMarkdown('- [x] done\n');
  const frame = /<svg [^>]*>/.exec(html)?.[0] ?? '';
  assert.ok(frame.includes(`class="${taskMarkClass}"`), frame);
  // Each attribute of the frame reaches the page, in its HTML name.
  for (const value of Object.values(taskMarkAttributes))
    assert.ok(frame.includes(`="${value}"`), value);
  assert.ok(html.includes(`<polyline points="${taskMarkPoints}">`));
});

await test('the sanitizer keeps the attributes of the mark and no other value', () => {
  const kept = sanitizeSchema.attributes?.['svg'] ?? [];
  for (const [name, value] of Object.entries(taskMarkAttributes))
    assert.ok(
      kept.some(
        (entry) =>
          Array.isArray(entry) &&
          entry[0] === name &&
          entry.length === 2 &&
          entry[1] === value,
      ),
      name,
    );
  assert.equal(kept.length, Object.keys(taskMarkAttributes).length + 1);
});
