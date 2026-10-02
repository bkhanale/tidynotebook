/**
 * The layout of an imported archive (record 0172).
 *
 * An export imports as it was written, its hidden notes included, and an
 * Obsidian vault imports with the settings of the tool left out, its pictures
 * in `attachments/` and its wiki links as standard links.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLinks, markdownLimits } from '@notesapp/markdown';
import {
  archiveLinks,
  entryRole,
  importedNoteText,
  placedPictures,
  skippedFiles,
  toolEntry,
} from './import-layout.ts';

await test('the settings of a tool stay out and every other hidden name comes in', () => {
  // Review of record 0172: every name that started with a dot was dropped,
  // so a backup with `.ideas/plan.md` did not come back whole.
  for (const path of [
    '.obsidian/app.json',
    'Vault/.obsidian/workspace.json',
    'Vault/.trash/old.md',
    'Vault/.git/HEAD',
    '.DS_Store',
    'Vault/.DS_Store',
    '__MACOSX/Vault/._Home.md',
    'Vault/._Home.md',
  ])
    assert.equal(toolEntry(path), true, path);
  for (const path of [
    '.ideas/plan.md',
    '.todo.md',
    'Vault/Home.md',
    'attachments/.cat.png',
    'a.b/c.md',
  ])
    assert.equal(toolEntry(path), false, path);
  assert.equal(entryRole('.ideas/plan.md'), 'note');
  assert.equal(entryRole('.todo.md'), 'note');
  assert.equal(entryRole('attachments/.cat.png'), 'picture');
});

await test('a file that is neither a note nor a picture stays out and is named', () => {
  for (const path of ['Board.canvas', 'paper.pdf', 'pic.svg', 'README'])
    assert.equal(entryRole(path), 'skipped', path);
  assert.deepEqual(
    skippedFiles([
      'Vault/.obsidian/app.json',
      'Board.canvas',
      'Other.canvas',
      'paper.PDF',
      'README',
    ]),
    { files: 5, kinds: ['canvas', 'file', 'pdf', 'settings'] },
  );
  assert.deepEqual(skippedFiles([]), { files: 0, kinds: [] });
});

await test('a picture outside the attachments folder moves into it, under a free name', () => {
  const placed = placedPictures(
    [
      'attachments/cat.png',
      'Vault/Pasted image.png',
      'x.png',
      'attachments/x.png',
    ],
    ['Vault/Home.md'],
  );
  assert.equal(placed.get('attachments/cat.png'), 'attachments/cat.png');
  assert.equal(
    placed.get('Vault/Pasted image.png'),
    'attachments/Vault/Pasted image.png',
  );
  // Review of record 0172: `x.png` and `attachments/x.png` were one path, so
  // the whole import was refused. Both come in now.
  assert.equal(placed.get('attachments/x.png'), 'attachments/x.png');
  assert.equal(placed.get('x.png'), 'attachments/x 2.png');
});

await test('the notes of an export keep every character', () => {
  const links = archiveLinks(
    ['a.md', 'b/c.md'],
    placedPictures(['attachments/shot.png'], []),
  );
  assert.equal(links.moved.size, 0);
  const text = '# A\n\n[C](b/c.md) ![shot](attachments/shot.png) and [[x]].\n';
  assert.equal(importedNoteText(text, 'a.md', links), text);
});

await test('a vault note links its notes and its pictures', () => {
  const links = archiveLinks(
    ['Vault/Home.md', 'Vault/Projects/Plan.md'],
    placedPictures(['Vault/Pasted image.png', 'Vault/img/dog.jpg'], []),
  );
  const text = [
    'See [[Plan]], [[Plan#Next steps|the steps]] and [[Missing]].',
    '',
    '![[Pasted image.png]]',
    '',
    '![a dog](img/dog.jpg)',
    '',
  ].join('\n');
  const imported = importedNoteText(text, 'Vault/Home.md', links);
  assert.equal(
    imported,
    [
      'See [Plan](Projects/Plan.md), [the steps](Projects/Plan.md#next-steps) and [[Missing]].',
      '',
      '![Pasted image.png](../attachments/Vault/Pasted%20image.png)',
      '',
      '![a dog](../attachments/Vault/img/dog.jpg)',
      '',
    ].join('\n'),
  );
  assert.deepEqual(
    extractLinks(imported, 'Vault/Home.md').map((link) => link.targetPath),
    ['Vault/Projects/Plan.md', 'Vault/Projects/Plan.md'],
  );
});

await test('a picture resolves in the folders of the vault and then takes its new path', () => {
  // Review of record 0172: the resolver read the paths in `attachments/`, so
  // the picture beside the note never won and two siblings were a tie.
  const links = archiveLinks(
    ['Vault/A/Home.md', 'Vault/B/Other.md', 'Vault/Deep/One/Two/Note.md'],
    placedPictures(
      [
        'Vault/A/cat.png',
        'Vault/B/cat.png',
        'Vault/dog.png',
        'Vault/Deep/One/dog.png',
      ],
      [],
    ),
  );
  assert.equal(
    importedNoteText('![[cat.png]]', 'Vault/A/Home.md', links),
    '![cat.png](../../attachments/Vault/A/cat.png)',
  );
  assert.equal(
    importedNoteText('![[cat.png]]', 'Vault/B/Other.md', links),
    '![cat.png](../../attachments/Vault/B/cat.png)',
  );
  // With none beside the note, the picture of the fewest folders wins.
  assert.equal(
    importedNoteText('![[dog.png]]', 'Vault/Deep/One/Two/Note.md', links),
    '![dog.png](../../../../attachments/Vault/dog.png)',
  );
});

await test('a note that a conversion would grow past the limit keeps its text', () => {
  const links = archiveLinks(
    ['Vault/Home.md', 'Vault/A long name.md'],
    new Map(),
  );
  const unit = '[[A long name]] ';
  const text = unit.repeat(
    Math.floor(markdownLimits.maxInputBytes / unit.length),
  );
  assert.equal(importedNoteText(text, 'Vault/Home.md', links), text);
});

await test('a vault note with a colon in its name links to it and never away', () => {
  const links = archiveLinks(
    ['Vault/Home.md', 'Vault/Meeting: Q3.md'],
    new Map(),
  );
  const imported = importedNoteText(
    'See [[Meeting: Q3]].',
    'Vault/Home.md',
    links,
  );
  assert.equal(imported, 'See [Meeting: Q3](Meeting%3A%20Q3.md).');
  assert.deepEqual(
    extractLinks(imported, 'Vault/Home.md').map((link) => link.targetPath),
    ['Vault/Meeting: Q3.md'],
  );
});
