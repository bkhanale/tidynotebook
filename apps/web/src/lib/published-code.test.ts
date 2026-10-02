/** The rules of the copy action of a published code block (record 0174). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { codeBlockClass, renderMarkdown } from '@notesapp/markdown';
import { copiedCode, publishedCodeSelector } from './published-code.ts';

await test('the script reads the figure that the renderer writes', async () => {
  assert.equal(publishedCodeSelector, `figure.${codeBlockClass}`);
  const html = await renderMarkdown('```sh\necho a\n```\n');
  assert.ok(html.startsWith('<figure class="notes-code">'), html);
});

await test('a copy takes the code and not the line break the renderer adds', () => {
  assert.equal(copiedCode('echo a\n'), 'echo a');
  assert.equal(copiedCode('a\n\n'), 'a\n');
  assert.equal(copiedCode('a'), 'a');
});
