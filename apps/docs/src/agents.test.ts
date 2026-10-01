import assert from 'node:assert/strict';
import test from 'node:test';
import {
  llmsFull,
  llmsIndex,
  markdownCopy,
  robots,
  sitemap,
} from './agents.ts';
import { readGuideIndex, readGuidePage } from './guide.ts';

const hosted = { base: '/notesapp/', origin: 'https://docs.bhu.sh' };
const local = { base: '/', origin: null };

const readme = [
  '# NotesApp guide',
  '',
  'This page is for anyone who uses NotesApp.',
  '',
  'NotesApp is a self-hosted Markdown notes application.',
  '',
  '## Writing notes',
  '',
  '- [Getting started](getting-started.md) - your first sign-in',
  '',
  '## Hosting a server',
  '',
  '- [Quick start](quickstart.md) - the shortest path to [a server](quickstart.md).',
].join('\n');
const start = [
  '# Getting started',
  '',
  'This page is for the person who writes notes.',
  '',
  'Read [Quick start](quickstart.md#open) first.',
].join('\n');
const quick = '# Quick start\n\nThis page is for the person who runs the server.\n';

const groups = readGuideIndex(readme);
const home = readGuidePage('README.md', readme);
const pages = [
  home,
  readGuidePage('getting-started.md', start),
  readGuidePage('quickstart.md', quick),
];
const files = new Set(pages.map((page) => page.file));

await test('llms.txt names every page with its summary', () => {
  assert.equal(
    llmsIndex(hosted, groups, home),
    [
      '# NotesApp docs',
      '',
      '> NotesApp is a self-hosted Markdown notes application.',
      '',
      'Each link opens the Markdown copy of one page. Every page in one file: https://docs.bhu.sh/notesapp/llms-full.txt. The pages for people start at https://docs.bhu.sh/notesapp/.',
      '',
      '## Writing notes',
      '',
      '- [Getting started](https://docs.bhu.sh/notesapp/getting-started.md): Your first sign-in.',
      '',
      '## Hosting a server',
      '',
      '- [Quick start](https://docs.bhu.sh/notesapp/quickstart.md): The shortest path to a server.',
      '',
    ].join('\n'),
  );
});

await test('a Markdown copy links the other copies', () => {
  assert.equal(
    markdownCopy(hosted, files, pages[1] ?? home),
    [
      '# Getting started',
      '',
      'This page is for the person who writes notes.',
      '',
      'Read [Quick start](https://docs.bhu.sh/notesapp/quickstart.md#open) first.',
      '',
    ].join('\n'),
  );
  assert.match(
    markdownCopy(local, files, pages[1] ?? home),
    /\[Quick start\]\(\/quickstart\.md#open\)/,
  );
});

await test('llms-full.txt holds every page in reading order', () => {
  const full = llmsFull(hosted, files, pages);
  const order = ['# NotesApp guide', '# Getting started', '# Quick start'].map(
    (title) => full.indexOf(title),
  );
  assert.ok(order.every((at) => at >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(full, /<!-- https:\/\/docs\.bhu\.sh\/notesapp\/quickstart\/ -->/);
});

await test('the sitemap names every page when the origin is known', () => {
  assert.equal(sitemap(local, pages), null);
  const map = sitemap(hosted, pages) ?? '';
  for (const path of ['', 'getting-started/', 'quickstart/'])
    assert.match(map, new RegExp(`<loc>https://docs\\.bhu\\.sh/notesapp/${path}</loc>`));
  assert.equal(
    robots(hosted),
    'User-agent: *\nAllow: /\nSitemap: https://docs.bhu.sh/notesapp/sitemap.xml\n',
  );
  assert.equal(robots(local), 'User-agent: *\nAllow: /\n');
});
