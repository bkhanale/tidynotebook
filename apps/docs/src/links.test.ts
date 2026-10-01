import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRelativeReferences, renderMarkdown } from '@notesapp/markdown';
import {
  editHref,
  guideFileOf,
  htmlDestination,
  markdownDestination,
  markdownHref,
  pageHref,
} from './links.ts';

const root = { base: '/', origin: null };
const hosted = { base: '/notesapp/', origin: 'https://docs.bhu.sh' };
const files = new Set(['README.md', 'quickstart.md', 'self-hosting.md']);

await test('a page has an address under the base and a Markdown copy', () => {
  assert.equal(pageHref(root, ''), '/');
  assert.equal(pageHref(hosted, 'quickstart'), '/notesapp/quickstart/');
  assert.equal(
    pageHref(hosted, 'self-hosting', '#user-content-mail'),
    '/notesapp/self-hosting/#user-content-mail',
  );
  assert.equal(markdownHref(hosted, ''), '/notesapp/index.md');
  assert.equal(markdownHref(hosted, 'quickstart'), '/notesapp/quickstart.md');
});

await test('only a file directly in the guide is a guide page', () => {
  assert.equal(guideFileOf('docs/guide/quickstart.md'), 'quickstart.md');
  assert.equal(guideFileOf('docs/development/identity.md'), null);
  assert.equal(guideFileOf('docs/guide/deep/page.md'), null);
  assert.equal(guideFileOf('SECURITY.md'), null);
});

await test('a rendered link between guide pages opens the page', async () => {
  const html = await renderMarkdown(
    [
      '[Quick start](quickstart.md), [Mail](self-hosting.md#mail),',
      '[Here](#logs), [Rules](../../SECURITY.md),',
      '[Identity](../development/identity.md#sessions)',
      'and [Site](https://example.com).',
    ].join('\n'),
    {
      sourcePath: 'docs/guide/README.md',
      noteHref: (target) => htmlDestination(hosted, files, target),
    },
  );
  assert.match(html, /href="\/notesapp\/quickstart\/"/);
  assert.match(html, /href="\/notesapp\/self-hosting\/#user-content-mail"/);
  assert.match(html, /href="#user-content-logs"/);
  assert.match(
    html,
    /href="https:\/\/github\.com\/bkhanale\/notesapp\/blob\/main\/SECURITY\.md"/,
  );
  assert.match(
    html,
    /href="https:\/\/github\.com\/bkhanale\/notesapp\/blob\/main\/docs\/development\/identity\.md#sessions"/,
  );
  assert.match(html, /href="https:\/\/example\.com"/);
});

await test('a link to a guide page that does not exist stops the build', async () => {
  await assert.rejects(
    renderMarkdown('[Gone](gone.md)', {
      sourcePath: 'docs/guide/README.md',
      noteHref: (target) => htmlDestination(hosted, files, target),
    }),
    /links docs\/guide\/gone\.md, and the guide has no such page/,
  );
  assert.throws(
    () => markdownDestination(hosted, files, 'docs/guide/gone.md', ''),
    /no such page/,
  );
});

await test('a Markdown copy links the other copies in full', () => {
  const mapped = mapRelativeReferences(
    '[Quick start](quickstart.md#open) and [Rules](../../SECURITY.md).',
    'docs/guide/README.md',
    (path, fragment) => markdownDestination(hosted, files, path, fragment),
  );
  assert.equal(
    mapped.text,
    '[Quick start](https://docs.bhu.sh/notesapp/quickstart.md#open) and [Rules](https://github.com/bkhanale/notesapp/blob/main/SECURITY.md).',
  );
  assert.equal(
    markdownDestination(root, files, 'docs/guide/README.md', ''),
    '/index.md',
  );
});

await test('the edit address opens the source of the page', () => {
  assert.equal(
    editHref('quickstart.md'),
    'https://github.com/bkhanale/notesapp/edit/main/docs/guide/quickstart.md',
  );
});

await test('a link out of the guide to no file of the repository stops the build', async () => {
  const known = new Set(['SECURITY.md']);
  await assert.rejects(
    renderMarkdown('[Rules](../../SECURTY.md)', {
      sourcePath: 'docs/guide/README.md',
      noteHref: (target) =>
        htmlDestination(hosted, files, target, (path) => known.has(path)),
    }),
    /links SECURTY\.md, and the repository has no such file/,
  );
  const html = await renderMarkdown('[Rules](../../SECURITY.md)', {
    sourcePath: 'docs/guide/README.md',
    noteHref: (target) =>
      htmlDestination(hosted, files, target, (path) => known.has(path)),
  });
  assert.match(html, /blob\/main\/SECURITY\.md/);
});
