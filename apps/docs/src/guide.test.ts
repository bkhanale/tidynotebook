import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '@notesapp/markdown';
import {
  indexProblems,
  readGuideIndex,
  readGuidePage,
  readingOrder,
  slugOf,
} from './guide.ts';

const index = [
  '# NotesApp guide',
  '',
  'This page is for anyone who uses NotesApp.',
  '',
  '## Writing notes',
  '',
  'For the person who writes the notes.',
  '',
  '- [Getting started](getting-started.md) - your first sign-in and your first',
  '  note.',
  '- [Markdown](markdown.md) - the syntax that the editor understands.',
  '- An item that is not a link.',
  '',
  '## Hosting a server',
  '',
  '- [Quick start](quickstart.md) - the shortest path.',
  '',
  'To report a problem, read [SECURITY.md](../../SECURITY.md).',
].join('\n');

await test('the index gives each group its pages and their summaries', () => {
  assert.deepEqual(readGuideIndex(index), [
    {
      title: 'Writing notes',
      pages: [
        {
          file: 'getting-started.md',
          title: 'Getting started',
          summary: 'your first sign-in and your first note.',
        },
        {
          file: 'markdown.md',
          title: 'Markdown',
          summary: 'the syntax that the editor understands.',
        },
      ],
    },
    {
      title: 'Hosting a server',
      pages: [
        {
          file: 'quickstart.md',
          title: 'Quick start',
          summary: 'the shortest path.',
        },
      ],
    },
  ]);
});

await test('the reading order starts at the index', () => {
  assert.deepEqual(readingOrder(readGuideIndex(index)), [
    'README.md',
    'getting-started.md',
    'markdown.md',
    'quickstart.md',
  ]);
});

await test('a page of the folder and a page of the index are one list', () => {
  const groups = readGuideIndex(index);
  assert.deepEqual(
    indexProblems(
      ['README.md', 'getting-started.md', 'markdown.md', 'quickstart.md'],
      groups,
    ),
    [],
  );
  assert.deepEqual(
    indexProblems(['README.md', 'getting-started.md', 'trash.md'], groups),
    [
      'README.md lists markdown.md, and docs/guide holds no such page.',
      'README.md lists quickstart.md, and docs/guide holds no such page.',
      'docs/guide/trash.md is in no group of README.md.',
    ],
  );
});

await test('the index page has an empty address', () => {
  assert.equal(slugOf('README.md'), '');
  assert.equal(slugOf('self-hosting.md'), 'self-hosting');
});

await test('a page names its title, its reader and its headings', async () => {
  const source = [
    '# Self-hosting',
    '',
    'This page is for the person who runs the server. It is the',
    'production installation guide.',
    '',
    'One application and one database.',
    '',
    '## Behind a reverse proxy',
    '',
    'Not part of the introduction.',
    '',
    '### The `TLS` profile',
    '',
    '## Logs',
    '',
    '## Logs',
  ].join('\n');
  const page = readGuidePage('self-hosting.md', source);
  assert.equal(page.title, 'Self-hosting');
  assert.equal(page.slug, 'self-hosting');
  assert.equal(
    page.description,
    'This page is for the person who runs the server. It is the production installation guide.',
  );
  assert.equal(page.introduction, 'One application and one database.');
  assert.deepEqual(page.headings, [
    {
      depth: 2,
      text: 'Behind a reverse proxy',
      id: 'user-content-behind-a-reverse-proxy',
    },
    { depth: 3, text: 'The TLS profile', id: 'user-content-the-tls-profile' },
    { depth: 2, text: 'Logs', id: 'user-content-logs' },
    { depth: 2, text: 'Logs', id: 'user-content-logs-2' },
  ]);
  // The identifiers are the ones that the one renderer writes.
  const html = await renderMarkdown(source);
  for (const heading of page.headings)
    assert.ok(html.includes(`id="${heading.id}"`), heading.id);
});

await test('a page with no title is refused', () => {
  assert.throws(
    () => readGuidePage('empty.md', 'Text only.'),
    /docs\/guide\/empty\.md has no # title/,
  );
});

await test('a nested heading counts toward the identifiers', async () => {
  const source = [
    '# Page',
    '',
    '> ## Logs',
    '',
    '- ## Logs',
    '',
    '## Logs',
    '',
    '## Sum $a+b$',
  ].join('\n');
  const page = readGuidePage('page.md', source);
  assert.deepEqual(
    page.headings.map((heading) => heading.id),
    ['user-content-logs-3', 'user-content-sum-a-b'],
  );
  const html = await renderMarkdown(source);
  for (const heading of page.headings)
    assert.ok(html.includes(`id="${heading.id}"`), heading.id);
});
