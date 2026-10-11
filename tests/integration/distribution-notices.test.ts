/** The actual shipped browser and documentation notice files. */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';

const repository =
  process.env['NOTESAPP_DISTRIBUTION_ROOT'] ??
  join(import.meta.dirname, '../..');

async function filesIn(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const file = join(directory, entry.name);
        return entry.isDirectory() ? filesIn(file) : [file];
      }),
    )
  ).flat();
}

await test('browser and documentation distributions retain licenses and notices', async () => {
  const original = await readFile(join(repository, 'LICENSE'), 'utf8');
  for (const output of ['apps/web/dist/web', 'apps/docs/dist/site']) {
    const licenses = join(repository, output, 'licenses');
    assert.equal(await readFile(join(licenses, 'LICENSE'), 'utf8'), original);
    const notices = await readFile(
      join(licenses, 'THIRD-PARTY-NOTICES.txt'),
      'utf8',
    );
    assert.match(notices, /react@/);
    assert.match(notices, /Permission is hereby granted/);
    assert.match(
      await readFile(join(licenses, 'borrowed-work/geist.txt'), 'utf8'),
      /SIL OPEN FONT LICENSE/,
    );
    assert.match(
      await readFile(join(licenses, 'borrowed-work/tokyo-night.txt'), 'utf8'),
      /Apache License/,
    );
    assert.match(
      await readFile(join(licenses, 'borrowed-work/gruvbox.txt'), 'utf8'),
      /Pavel Pertsev/,
    );
    assert.match(
      await readFile(join(licenses, 'SOURCE.txt'), 'utf8'),
      /AGPL-3.0-only/,
    );
  }
});

await test('documentation search retains its Wasm terms and locked preferred source', async () => {
  const licenses = join(repository, 'apps/docs/dist/site/licenses');
  assert.match(
    await readFile(
      join(licenses, 'borrowed-work/pagefind-wasm-notices.txt'),
      'utf8',
    ),
    /pagefind_microjson@0\.1\.4[\s\S]*GPL-3\.0-only/,
  );
  assert.match(
    await readFile(
      join(licenses, 'borrowed-work/pagefind-wasm-notices.txt'),
      'utf8',
    ),
    /GNU GENERAL PUBLIC LICENSE/,
  );
  assert.match(
    await readFile(join(licenses, 'PAGEFIND-SOURCE.txt'), 'utf8'),
    /local_build\.sh/,
  );
  const expected = await readFile(
    join(repository, 'tools/pagefind-sources.json'),
    'utf8',
  );
  assert.equal(
    await readFile(join(licenses, 'pagefind-source/manifest.json'), 'utf8'),
    expected,
  );
  const manifest: unknown = JSON.parse(expected);
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('sources' in manifest) ||
    !Array.isArray(manifest.sources)
  )
    throw new Error('Source manifest is invalid.');
  for (const row of manifest.sources) {
    if (
      typeof row !== 'object' ||
      row === null ||
      !('file' in row) ||
      typeof row.file !== 'string' ||
      !('sha256' in row) ||
      typeof row.sha256 !== 'string'
    )
      throw new Error('Source row is invalid.');
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(licenses, 'pagefind-source', row.file)))
        .digest('hex'),
      row.sha256,
    );
  }
});

await test('no browser script, frame or source map contains the excluded ELK engine', async () => {
  const files = await filesIn(join(repository, 'apps/web/dist/web'));
  const codeFiles = files.filter((file) => /\.(?:html|js|mjs|map)$/.test(file));
  assert.ok(codeFiles.some((file) => file.endsWith('src/diagram/frame.html')));
  for (const file of codeFiles)
    assert.doesNotMatch(
      await readFile(file, 'utf8'),
      /org\.eclipse\.elk|elkjs\/lib|Kiel University|elk\.layered/i,
      file,
    );
});
