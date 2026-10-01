import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '@notesapp/markdown';
import { joinSoftBreaks } from './prose.ts';

await test('a wrapped paragraph and a wrapped list item read as one line', () => {
  assert.equal(
    joinSoftBreaks(
      [
        'This page is for the person who runs the server. It is the',
        'production installation guide.',
        '',
        '- [Getting started](getting-started.md) - your first sign-in and your',
        '  first note, with **bold',
        '  words** inside.',
      ].join('\n'),
    ),
    [
      'This page is for the person who runs the server. It is the production installation guide.',
      '',
      '- [Getting started](getting-started.md) - your first sign-in and your first note, with **bold words** inside.',
    ].join('\n'),
  );
});

await test('a hard break, code, inline code and a table stay as written', () => {
  const source = [
    'One line\\',
    'and a hard break.',
    '',
    '```sh',
    'docker compose up -d',
    'docker compose ps',
    '```',
    '',
    '| A | B |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    'Run `a',
    'b` now.',
  ].join('\n');
  assert.equal(joinSoftBreaks(source), source);
});

await test('the renderer then writes no line break inside a paragraph', async () => {
  const html = await renderMarkdown(
    joinSoftBreaks('First line of a\nparagraph.\n\nSecond\\\nwith a break.'),
  );
  assert.equal(
    html,
    '<p>First line of a paragraph.</p>\n<p>Second<br>\nwith a break.</p>',
  );
});

await test('a wrapped quote and alert keep their structure', async () => {
  const source = [
    '> [!NOTE]',
    '> The first line of the',
    '> alert, and the second.',
    '',
    '> A quote',
    '>   that wraps.',
  ].join('\n');
  assert.equal(
    joinSoftBreaks(source),
    [
      '> [!NOTE]',
      '> The first line of the alert, and the second.',
      '',
      '> A quote that wraps.',
    ].join('\n'),
  );
  const html = await renderMarkdown(joinSoftBreaks(source));
  assert.doesNotMatch(html, /&gt;/);
  assert.match(html, /data-alert="note"/);
  assert.match(html, /The first line of the alert, and the second\./);
  assert.doesNotMatch(html, /\[!NOTE\]/);
  assert.match(html, /<p>A quote that wraps\.<\/p>/);
});
