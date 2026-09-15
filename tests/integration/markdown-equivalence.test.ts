/**
 * One Markdown grammar, checked from both ends.
 *
 * The product has two readers of a note. `renderMarkdown` in
 * `@notesapp/markdown` produces the reference HTML, and the live preview in
 * `@notesapp/editor` decorates the source in place. Decision D1 says they
 * are two views of one grammar, not two implementations of Markdown, and
 * this test is what holds them to it.
 *
 * The shared corpus is read through both paths and reduced to the same list
 * of structural facts: headings with their level and text, list items with
 * their depth and their ordered flag, code blocks with their info string,
 * tables with their row and column counts, block quotes with their depth,
 * task items with their checked flag, and thematic breaks. The two lists
 * must be equal, in order.
 *
 * The editor side of the list is produced by the very function that builds
 * the decorations, so a construct that stops being decorated also stops
 * appearing here.
 *
 * The generated footnote section is left out of the HTML side. The renderer
 * moves footnote definitions to the end of the document and wraps them in a
 * list, which is a rendering choice about placement rather than a
 * disagreement about the grammar.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { previewStructureOf } from '@notesapp/editor';
import type { PreviewNode } from '@notesapp/editor';
import { renderMarkdown } from '@notesapp/markdown';
import { corpusMarkdown } from '../../packages/markdown/test-data/content.ts';

/** One HTML tag, as the scanner below sees it. */
type Tag = {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly attributes: string;
  readonly from: number;
  readonly to: number;
};

/** Lists the tags of one HTML string in order. */
function tagsOf(html: string): readonly Tag[] {
  const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const found: Tag[] = [];
  for (;;) {
    const match = pattern.exec(html);
    if (match === null) return found;
    const attributes = match[3] ?? '';
    found.push({
      name: (match[2] ?? '').toLowerCase(),
      closing: (match[1] ?? '') === '/',
      selfClosing: attributes.trimEnd().endsWith('/'),
      attributes,
      from: match.index,
      to: match.index + (match[0] ?? '').length,
    });
  }
}

/** The visible text of an HTML range, with markup and entities resolved. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The value of one attribute of a tag, or null. */
function attribute(tag: Tag, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}(?:="([^"]*)")?`).exec(
    tag.attributes,
  );
  if (match === null) return null;
  return match[1] ?? '';
}

/**
 * The same structural facts, read from the reference HTML.
 *
 * The scanner is deliberately small and local to this test: it must not
 * share code with either path, or it could hide a disagreement.
 */
function renderedStructure(html: string): readonly PreviewNode[] {
  const found: PreviewNode[] = [];
  const tags = tagsOf(html);
  const lists: boolean[] = [];
  let quoteDepth = 0;
  let footnotes = 0;
  let table: { rows: number; columns: number; firstRow: boolean } | null = null;
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag === undefined) continue;
    // The renderer moves footnote definitions into a section of their own at
    // the end. That placement is not a grammar difference.
    if (tag.name === 'section' && attribute(tag, 'data-footnotes') !== null)
      footnotes += tag.closing ? -1 : 1;
    if (footnotes > 0) continue;
    if (
      tag.name === 'pre' &&
      !tag.closing &&
      attribute(tag, 'data-frontmatter') === 'yaml'
    ) {
      found.push({ kind: 'front-matter' });
      continue;
    }
    if (tag.name === 'hr' && !tag.closing) {
      found.push({ kind: 'thematic-break' });
      continue;
    }
    if (tag.name === 'blockquote') {
      if (tag.closing) quoteDepth -= 1;
      else {
        quoteDepth += 1;
        found.push({ kind: 'quote', depth: quoteDepth });
      }
      continue;
    }
    if (tag.name === 'ul' || tag.name === 'ol') {
      if (tag.closing) lists.pop();
      else lists.push(tag.name === 'ol');
      continue;
    }
    if (tag.name === 'li' && !tag.closing) {
      found.push({
        kind: 'list-item',
        depth: lists.length,
        ordered: lists[lists.length - 1] ?? false,
      });
      if (attribute(tag, 'class') === 'task-list-item') {
        const box = tags[index + 1];
        found.push({
          kind: 'task',
          checked: box !== undefined && attribute(box, 'checked') !== null,
        });
      }
      continue;
    }
    if (tag.name === 'table') {
      if (tag.closing) {
        if (table !== null)
          found.push({
            kind: 'table',
            rows: table.rows,
            columns: table.columns,
          });
        table = null;
      } else table = { rows: 0, columns: 0, firstRow: true };
      continue;
    }
    if (table !== null && tag.name === 'tr' && !tag.closing) {
      table.rows += 1;
      if (table.rows > 1) table.firstRow = false;
      continue;
    }
    if (
      table !== null &&
      table.firstRow &&
      (tag.name === 'th' || tag.name === 'td') &&
      !tag.closing
    ) {
      table.columns += 1;
      continue;
    }
    const heading = /^h([1-6])$/.exec(tag.name);
    if (heading !== null && !tag.closing) {
      const close = tags.find(
        (other, position) =>
          position > index && other.closing && other.name === tag.name,
      );
      found.push({
        kind: 'heading',
        level: Number(heading[1]),
        text: textOf(html.slice(tag.to, close?.from ?? tag.to)),
      });
      continue;
    }
    if (tag.name === 'pre' && !tag.closing) {
      const diagram = attribute(tag, 'data-diagram');
      if (diagram !== null) {
        found.push({ kind: 'code-block', info: diagram });
        continue;
      }
      const code = tags[index + 1];
      const language =
        code === undefined || code.name !== 'code'
          ? null
          : attribute(code, 'class');
      found.push({
        kind: 'code-block',
        info: language === null ? '' : language.replace(/^language-/, ''),
      });
      continue;
    }
  }
  return found;
}

await test('front matter is metadata in both Markdown paths', async () => {
  const source = '---\ntitle: Example\ntags: [one, two]\n---\n\n# Body\n';
  const html = await renderMarkdown(source);
  assert.equal(
    html,
    '<pre data-frontmatter="yaml">title: Example\ntags: [one, two]</pre>\n<h1 id="user-content-body">Body</h1>',
  );
  assert.deepEqual(previewStructureOf(source), [
    { kind: 'front-matter' },
    { kind: 'heading', level: 1, text: 'Body' },
  ]);
});

await test('the corpus has the same structure through both paths', async () => {
  const html = await renderMarkdown(corpusMarkdown);
  const rendered = renderedStructure(html);
  const preview = previewStructureOf(corpusMarkdown);
  assert.ok(rendered.length > 20, 'the corpus lost its content');
  assert.deepEqual(preview, rendered);
});

await test('the corpus keeps every construct the matrix covers', async () => {
  const preview = previewStructureOf(corpusMarkdown);
  const kinds = new Set(preview.map((node) => node.kind));
  const expected: readonly PreviewNode['kind'][] = [
    'front-matter',
    'heading',
    'list-item',
    'task',
    'code-block',
    'table',
    'quote',
    'thematic-break',
  ];
  for (const kind of expected) assert.ok(kinds.has(kind), kind);
  const levels = new Set(
    preview.flatMap((node) => (node.kind === 'heading' ? [node.level] : [])),
  );
  assert.deepEqual(
    [...levels].sort((left, right) => left - right),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(
    preview.some((node) => node.kind === 'quote' && node.depth === 2),
    'the corpus lost its nested quote',
  );
  assert.ok(
    preview.some((node) => node.kind === 'list-item' && node.depth === 3),
    'the corpus lost its deep list',
  );
});
