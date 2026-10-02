/**
 * The converter of wiki links (record 0172).
 *
 * Each form of Obsidian becomes the standard link that a note stores, a
 * target that does not resolve keeps its text, and a `[[` in code, in math,
 * in HTML, in a link or behind a backslash stays as it is. The links that the
 * converter writes go back through `extractLinks`, so each one reaches the
 * note it names.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Nodes } from 'mdast';
import { visit } from 'unist-util-visit';
import { extractLinks } from './links.ts';
import { parseMarkdown } from './parse.ts';
import {
  convertWikiLinks,
  noteLinkLabel,
  standardNoteLink,
  wikiLinkResolver,
} from './wiki-links.ts';

/** The paths of one small vault inside the folder of its archive. */
const vault = [
  'Vault/Home.md',
  'Vault/Projects/Plan.md',
  'Vault/Projects/Notes.md',
  'Vault/Archive/Notes.md',
  'Vault/Archive/Old/Plan.md',
  'Vault/C# [draft].md',
  'attachments/Vault/cat.png',
  'attachments/Vault/img/dog.jpg',
];

const resolve = wikiLinkResolver(vault);

/** Converts one line of the home note of the vault. */
function home(text: string): string {
  return convertWikiLinks(text, 'Vault/Home.md', resolve).text;
}

await test('each form of a wiki link becomes a standard link', () => {
  assert.equal(home('[[Plan]]'), '[Plan](Projects/Plan.md)');
  assert.equal(home('[[Plan|the plan]]'), '[the plan](Projects/Plan.md)');
  assert.equal(
    home('[[Plan#Next steps]]'),
    '[Plan > Next steps](Projects/Plan.md#next-steps)',
  );
  assert.equal(home('[[Archive/Notes]]'), '[Archive/Notes](Archive/Notes.md)');
  assert.equal(home('[[Plan#^a1b2]]'), '[Plan](Projects/Plan.md)');
  assert.equal(home('[[#Local heading]]'), '[Local heading](#local-heading)');
  assert.equal(
    home('![[cat.png]]'),
    '![cat.png](../attachments/Vault/cat.png)',
  );
  assert.equal(
    home('![[cat.png|300]]'),
    '![cat.png](../attachments/Vault/cat.png)',
  );
  assert.equal(
    home('![[img/dog.jpg|A dog]]'),
    '![A dog](../attachments/Vault/img/dog.jpg)',
  );
  // No surface draws one note inside another, so an embed of a note is a link.
  assert.equal(home('![[Plan]]'), '[Plan](Projects/Plan.md)');
  assert.equal(home('[[Plan.md]]'), '[Plan.md](Projects/Plan.md)');
});

await test('an embed is a picture only for an image type of the workspace', () => {
  // The converter read svg, avif and bmp as pictures, which no workspace
  // keeps, so a vault that held one wrote a picture of nothing.
  const resolveAll = wikiLinkResolver([
    'a.md',
    'attachments/x.svg',
    'attachments/y.JPG',
  ]);
  assert.equal(
    convertWikiLinks('![[x.svg]]', 'a.md', resolveAll).text,
    '![[x.svg]]',
  );
  assert.equal(
    convertWikiLinks('![[y.JPG]]', 'a.md', resolveAll).text,
    '![y.JPG](attachments/y.JPG)',
  );
});

await test('a target that does not resolve keeps its text', () => {
  for (const text of [
    '[[Missing]]',
    '![[missing.png]]',
    // Two notes of this name at one depth, and neither beside the home note.
    '[[Notes]]',
    '[[]]',
    '[[#]]',
    '[[/Vault/Home]]',
  ])
    assert.equal(home(text), text);
});

await test('a wiki link in code, math, HTML or a link stays as it is', () => {
  for (const text of [
    '`[[Plan]]`',
    '```\n[[Plan]]\n```',
    '$$[[Plan]]$$',
    '$a [[Plan]] b$',
    '<span title="[[Plan]]">x</span>',
    '[see [[Plan]]](https://example.com)',
    '<https://example.com/[[Plan]]>',
    '\\[[Plan]]',
    '[[Pl\nan]]',
  ])
    assert.equal(home(text), text, text);
  // An escaped backslash leaves the brackets free.
  assert.equal(home('\\\\[[Plan]]'), '\\\\[Plan](Projects/Plan.md)');
});

await test('a wiki link in a table keeps the cells of its row', () => {
  const table = '| Link | Note |\n| --- | --- |\n| [[Plan\\|the plan]] | x |\n';
  assert.equal(
    home(table),
    '| Link | Note |\n| --- | --- |\n| [the plan](Projects/Plan.md) | x |\n',
  );
  // A bare bar ends the cell, as GFM and Obsidian read it, so the link would
  // join two cells and stays text.
  const split = '| a | b |\n| - | - |\n| [[Plan|x]] | y |\n';
  assert.equal(home(split), split);
});

await test('a target resolves as Obsidian resolves it', () => {
  // A bare name: the one of that name, the one in the folder of the note,
  // then the fewest folders. Two at the same depth are a tie.
  assert.equal(resolve('Home', 'Vault/Projects/Plan.md'), 'Vault/Home.md');
  assert.equal(
    resolve('Notes', 'Vault/Archive/Old/Plan.md'),
    null,
    'a tie of two at one depth stays unresolved',
  );
  assert.equal(resolve('Notes', 'Vault/Home.md'), null);
  assert.equal(
    resolve('Notes', 'Vault/Archive/x.md'),
    'Vault/Archive/Notes.md',
  );
  assert.equal(resolve('Plan', 'Vault/Home.md'), 'Vault/Projects/Plan.md');
  assert.equal(
    resolve('Plan', 'Vault/Archive/Old/a.md'),
    'Vault/Archive/Old/Plan.md',
  );
  // Case aside, and a path from the folder of the note, from the root, or as
  // the end of a longer path.
  assert.equal(resolve('home', 'Vault/Projects/Plan.md'), 'Vault/Home.md');
  assert.equal(resolve('../Home', 'Vault/Projects/Plan.md'), 'Vault/Home.md');
  assert.equal(resolve('Vault/Home', 'x.md'), 'Vault/Home.md');
  assert.equal(
    resolve('Projects/Notes', 'Vault/Home.md'),
    'Vault/Projects/Notes.md',
  );
  assert.equal(
    resolve('Old/Plan', 'Vault/Home.md'),
    'Vault/Archive/Old/Plan.md',
  );
  assert.equal(resolve('Projects/Missing', 'Vault/Home.md'), null);
});

/** The text of each link of one note, as a reader sees it. */
function linkTexts(source: string): readonly string[] {
  const texts: string[] = [];
  visit(parseMarkdown(source), (node: Nodes) => {
    if (node.type !== 'link') return;
    let text = '';
    visit(node, (inner: Nodes) => {
      if (inner.type === 'text' || inner.type === 'inlineCode')
        text += inner.value;
    });
    texts.push(text);
  });
  return texts;
}

await test('a label holds the name it shows, whatever the name holds', () => {
  const link = standardNoteLink(
    'Vault/Home.md',
    'Vault/C# [draft].md',
    'C# [draft]',
  );
  assert.equal(link, '[C# \\[draft\\]](C%23%20[draft].md)');
  assert.deepEqual(
    extractLinks(link, 'Vault/Home.md').map((found) => found.targetPath),
    ['Vault/C# [draft].md'],
  );
  for (const name of [
    'C# [draft]',
    '*bold*',
    'a_b_c',
    'x | y',
    '$5 and $x$',
    '<tag>',
    'a &amp; b',
    '~~s~~',
    '`c`',
    'a\\b',
  ])
    assert.deepEqual(linkTexts(`[${noteLinkLabel(name)}](x.md)`), [name], name);
});

await test('every converted link reaches the note it names', () => {
  const text = home(
    'A [[Plan]], [[Archive/Notes|old notes]] and ![[cat.png]].',
  );
  assert.deepEqual(
    extractLinks(text, 'Vault/Home.md').map((link) => link.targetPath),
    ['Vault/Projects/Plan.md', 'Vault/Archive/Notes.md'],
  );
  const counted = convertWikiLinks(
    '[[Plan]] [[Missing]] [[Home]]',
    'Vault/Home.md',
    resolve,
  );
  assert.equal(counted.count, 2);
  assert.equal(
    counted.text,
    '[Plan](Projects/Plan.md) [[Missing]] [Home](Home.md)',
  );
});

await test('a byte order mark keeps the offsets of the source', () => {
  assert.equal(
    convertWikiLinks(
      '\uFEFFA `[[Plan]]` and [[Plan]].',
      'Vault/Home.md',
      resolve,
    ).text,
    '\uFEFFA `[[Plan]]` and [Plan](Projects/Plan.md).',
  );
});
