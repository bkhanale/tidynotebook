/**
 * Renderer checks for the paths the corpus cannot cover on its own: the
 * reference forms, the resource limits, and the sanitizer acting as the second
 * gate behind the URL policy.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { attachmentIdA, noteIdA } from '../test-data/content.ts';
import {
  markdownLimits,
  MarkdownLimitError,
  renderMarkdown,
} from './render.ts';

await test('the URL policy applies to a reference link', async () => {
  const html = await renderMarkdown(
    '[shown][evil]\n\n[evil]: javascript:alert(1)\n',
  );
  assert.ok(html.includes('<span data-blocked="link">shown</span>'));
  assert.ok(!html.includes('javascript:'));
});

await test('the URL policy applies to a reference image', async () => {
  const html = await renderMarkdown(
    `![alt][pic]\n\n[pic]: /attachments/${attachmentIdA}\n`,
  );
  assert.ok(
    html.includes(`<img src="/attachments/${attachmentIdA}" alt="alt">`),
  );
});

await test('the URL policy applies to an autolink and a GFM literal', async () => {
  const html = await renderMarkdown(
    '<https://example.com/a> and www.example.com and <mailto:a@example.com>\n',
  );
  assert.ok(
    html.includes(
      '<a href="https://example.com/a" rel="noopener noreferrer">https://example.com/a</a>',
    ),
  );
  assert.ok(html.includes('href="http://www.example.com"'));
  assert.ok(html.includes('<a href="mailto:a@example.com"'));
});

await test('an image keeps its title and normalizes its identifier', async () => {
  const html = await renderMarkdown(
    `![alt](/attachments/${attachmentIdA.toUpperCase()} "a title")\n`,
  );
  assert.ok(
    html.includes(
      `<img src="/attachments/${attachmentIdA}" alt="alt" title="a title">`,
    ),
  );
});

await test('an internal note link carries no rel attribute', async () => {
  const html = await renderMarkdown(`[a](/notes/${noteIdA})\n`);
  assert.equal(html.trim(), `<p><a href="/notes/${noteIdA}">a</a></p>`);
});

await test('a language class that is not a plain word is dropped', async () => {
  const html = await renderMarkdown('```c++ evil"\ncode\n```\n');
  assert.ok(html.includes('<pre><code>code\n</code></pre>'));
  assert.ok(!html.includes('class='));
});

await test('raw HTML and its content are dropped', async () => {
  const html = await renderMarkdown(
    '<script>alert(1)</script>\n\ntext <img src="x" onerror="alert(2)"> more\n',
  );
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('alert(1)'));
  assert.ok(!html.includes('onerror'));
  assert.ok(html.includes('text  more'));
});

await test('a heading renders with no attribute at all', async () => {
  const html = await renderMarkdown('# Heading\n');
  assert.equal(html.trim(), '<h1>Heading</h1>');
});

await test('text inside a math or diagram placeholder is escaped', async () => {
  const html = await renderMarkdown(
    '$</span><script>x</script>$\n\n```mermaid\n</pre><script>y</script>\n```\n',
  );
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&#x3C;script>x&#x3C;/script>'));
  assert.ok(html.includes('<pre data-diagram="mermaid">'));
});

await test('input above the byte limit is refused', async () => {
  const source = 'x'.repeat(markdownLimits.maxInputBytes + 1);
  await assert.rejects(renderMarkdown(source), (error: unknown) => {
    assert.ok(error instanceof MarkdownLimitError);
    assert.equal(error.reason, 'input-size');
    assert.equal(error.limit, markdownLimits.maxInputBytes);
    assert.equal(error.actual, markdownLimits.maxInputBytes + 1);
    return true;
  });
});

await test('the limit counts bytes and not characters', async () => {
  // Two bytes each, so this is exactly at the limit and must render.
  const source = '\u00e9'.repeat(markdownLimits.maxInputBytes / 2);
  assert.ok((await renderMarkdown(source)).length > 0);
  await assert.rejects(
    renderMarkdown(`${source}\u00e9`),
    (error: unknown) =>
      error instanceof MarkdownLimitError && error.reason === 'input-size',
  );
});

await test('a document exactly at the byte limit renders', async () => {
  const source = 'x'.repeat(markdownLimits.maxInputBytes);
  assert.ok((await renderMarkdown(source)).includes('<p>'));
});

await test('a document nested past the depth limit is refused', async () => {
  const source = `${'>'.repeat(5000)} deep\n`;
  await assert.rejects(renderMarkdown(source), (error: unknown) => {
    assert.ok(error instanceof MarkdownLimitError);
    assert.equal(error.reason, 'nesting-depth');
    assert.equal(error.limit, markdownLimits.maxNestingDepth);
    assert.ok(error.actual > markdownLimits.maxNestingDepth);
    return true;
  });
});

await test('a document just inside the depth limit renders', async () => {
  const source = `${'>'.repeat(50)} deep\n`;
  assert.ok((await renderMarkdown(source)).includes('deep'));
});
