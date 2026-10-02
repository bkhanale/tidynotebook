/** The rules of the copy action of a published code block (record 0174). */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  codeBlockClass,
  codeLabelClass,
  renderMarkdown,
} from '@notesapp/markdown';
import {
  copiedCode,
  publishedCodeLabel,
  publishedCodeLabelSelector,
  publishedCodeSelector,
} from './published-code.ts';

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

await test('a copy control names its block by the label of the figure', async () => {
  // Review of record 0174: every control of a page had the one name "Copy
  // code".
  assert.equal(publishedCodeLabelSelector, `figcaption.${codeLabelClass}`);
  const html = await renderMarkdown('```py\nx = 1\n```\n');
  assert.ok(
    html.includes(`<figcaption class="${codeLabelClass}">Python</figcaption>`),
    html,
  );
  const figure = (caption: string | null) => ({
    querySelector: (selector: string) =>
      selector === publishedCodeLabelSelector && caption !== null
        ? { textContent: caption }
        : null,
  });
  assert.equal(publishedCodeLabel(figure('Python')), 'Python');
  assert.equal(publishedCodeLabel(figure(' ')), null);
  assert.equal(publishedCodeLabel(figure(null)), null);
});
