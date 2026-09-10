/** Regression checks for a full note copied from a Markdown file. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from './render.ts';

const attachmentId = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
const document = [
  '# Title',
  '',
  '## Formatting',
  '',
  'Plain text with *emphasis*, **strong text**, ***both***, ~~deleted text~~,',
  'an escaped \\*asterisk\\*, and `inline code`.',
  '',
  '1. First ordered item',
  '2. Second ordered item',
  '   1. Nested ordered item',
  '   2. Another nested item',
  '',
  '- Unordered item',
  '  - Nested item',
  '    - Deep item',
  '',
  '- [x] Complete task',
  '- [ ] Open task',
  '',
  '> A block quote',
  '>',
  '> > A nested quote',
  '',
  '---',
  '',
  '| Name | Value | Escaped |',
  '| :--- | ----: | :------ |',
  '| one  | 1     | a \\| b  |',
  '',
  '[external](https://example.com) and <https://example.org>.',
  '',
  `![local image](/attachments/${attachmentId})`,
  '',
  '```typescript',
  'const answer: number = 42;',
  '```',
  '',
  'Term with a footnote.[^note]',
  '',
  '[^note]: Footnote text.',
  '',
  'Inline math $$x^2$$ and display math:',
  '',
  '$$',
  'x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a}',
  '$$',
  '',
].join('\n');

const html = await renderMarkdown(document, {
  attachmentHref: (id) => `/api/workspaces/workspace/attachments/${id}`,
});

await test('a complete copied Markdown note renders its block structure', () => {
  assert.ok(html.includes('<h1 id="user-content-title">Title</h1>'));
  assert.ok(html.includes('<h2 id="user-content-formatting">Formatting</h2>'));
  assert.ok(html.includes('<ol>'));
  assert.ok(html.includes('<ul class="contains-task-list">'));
  assert.ok(html.includes('<blockquote>'));
  assert.ok(html.includes('<hr>'));
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<pre><code class="language-typescript">'));
  assert.ok(html.includes('<section data-footnotes class="footnotes">'));
});

await test('a complete copied Markdown note renders inline syntax', () => {
  assert.ok(html.includes('<em>emphasis</em>'));
  assert.ok(html.includes('<strong>strong text</strong>'));
  assert.ok(html.includes('<em><strong>both</strong></em>'));
  assert.ok(html.includes('<del>deleted text</del>'));
  assert.ok(html.includes('<code>inline code</code>'));
  assert.ok(html.includes('a | b'));
  assert.ok(html.includes('class="notes-math notes-math-inline"'));
  assert.ok(html.includes('class="notes-math notes-math-display"'));
});

await test('the application attachment route survives sanitizing', () => {
  assert.ok(
    html.includes(
      `<img src="/api/workspaces/workspace/attachments/${attachmentId}" alt="local image">`,
    ),
  );
});
