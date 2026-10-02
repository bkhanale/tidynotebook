/**
 * The layout of an imported archive (record 0172).
 *
 * An export imports as it was written, and an Obsidian vault imports with its
 * hidden entries left out, its pictures in `attachments/` and its wiki links
 * as standard links.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLinks, markdownLimits } from '@notesapp/markdown';
import {
  archiveLinks,
  hiddenEntry,
  importedNoteText,
  importedPicturePath,
} from './import-layout.ts';

await test('the hidden entries of a vault and of a system are left out', () => {
  for (const path of [
    '.obsidian/app.json',
    'Vault/.obsidian/workspace.json',
    'Vault/.trash/old.md',
    '.DS_Store',
    '__MACOSX/Vault/._Home.md',
  ])
    assert.equal(hiddenEntry(path), true, path);
  for (const path of ['Vault/Home.md', 'attachments/cat.png', 'a.b/c.md'])
    assert.equal(hiddenEntry(path), false, path);
});

await test('a picture outside the attachments folder moves into it', () => {
  assert.equal(
    importedPicturePath('attachments/cat.png'),
    'attachments/cat.png',
  );
  assert.equal(
    importedPicturePath('Vault/Pasted image.png'),
    'attachments/Vault/Pasted image.png',
  );
});

await test('the notes of an export keep every character', () => {
  const links = archiveLinks(['a.md', 'b/c.md'], ['attachments/shot.png']);
  assert.equal(links.moved.size, 0);
  const text = '# A\n\n[C](b/c.md) ![shot](attachments/shot.png) and [[x]].\n';
  assert.equal(importedNoteText(text, 'a.md', links), text);
});

await test('a vault note links its notes and its pictures', () => {
  const links = archiveLinks(
    ['Vault/Home.md', 'Vault/Projects/Plan.md'],
    ['Vault/Pasted image.png', 'Vault/img/dog.jpg'],
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

await test('a note that a conversion would grow past the limit keeps its text', () => {
  const links = archiveLinks(['Vault/Home.md', 'Vault/A long name.md'], []);
  const unit = '[[A long name]] ';
  const text = unit.repeat(
    Math.floor(markdownLimits.maxInputBytes / unit.length),
  );
  assert.equal(importedNoteText(text, 'Vault/Home.md', links), text);
});
