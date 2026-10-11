import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { dependencyNotices } from './distribution-notices.mjs';
import { sourceMatches, sourceRows } from './native-sources.mjs';
import { root, readJson } from './workspace.mjs';

await test('an installed graph retains notices and refuses a missing required package', async () => {
  const directory = await mkdtemp(join(root, '.tooling/notices-test-'));
  try {
    await mkdir(join(directory, 'node_modules/fixture'), { recursive: true });
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: '@notesapp/fixture',
        dependencies: { fixture: '1.0.0' },
        optionalDependencies: { absent: '1.0.0' },
      }),
    );
    await writeFile(
      join(directory, 'node_modules/fixture/package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        license: 'MIT',
        repository: 'https://example.com/fixture',
      }),
    );
    await writeFile(
      join(directory, 'node_modules/fixture/LICENSE'),
      'Copyright fixture author\nFull license text\n',
    );
    const graph = await dependencyNotices(directory);
    assert.equal(graph.length, 1);
    assert.equal(graph[0]?.name, 'fixture');
    assert.equal(
      graph[0]?.notices[0]?.text,
      'Copyright fixture author\nFull license text\n',
    );
    await rm(join(directory, 'node_modules/fixture/LICENSE'));
    await assert.rejects(dependencyNotices(directory), /No complete notice/);
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: '@notesapp/fixture',
        dependencies: { missingRequiredFixture: '1.0.0' },
      }),
    );
    await assert.rejects(
      dependencyNotices(directory),
      /missingRequiredFixture is missing/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('source hashes refuse changed bytes and source rows refuse paths', () => {
  const bytes = Buffer.from('abc');
  assert.ok(
    sourceMatches(
      bytes,
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ),
  );
  assert.equal(
    sourceMatches(
      Buffer.from('abcd'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ),
    false,
  );
  assert.throws(
    () =>
      sourceRows([
        {
          file: '../escape',
          url: 'https://example.com',
          sha256: 'a'.repeat(64),
        },
      ]),
    /invalid/,
  );
  assert.throws(
    () =>
      sourceRows([
        {
          file: 'source.tar.gz',
          url: 'http://example.com',
          sha256: 'a'.repeat(64),
        },
      ]),
    /invalid/,
  );
});

await test('source rows refuse reserved and duplicate names', () => {
  for (const file of ['.', '..', 'manifest.json'])
    assert.throws(
      () =>
        sourceRows([
          { file, url: 'https://example.com', sha256: 'a'.repeat(64) },
        ]),
      /invalid/,
    );
  const row = {
    file: 'source.tar.gz',
    url: 'https://example.com',
    sha256: 'a'.repeat(64),
  };
  assert.throws(() => sourceRows([row, row]), /invalid/);
});

await test('native source versions match the installed library', async () => {
  const manifest = await readJson(join(root, 'tools/native-sources.json'));
  const require = createRequire(join(root, 'apps/server/package.json'));
  const sharpRequire = createRequire(require.resolve('sharp'));
  const packageFile = dirname(
    sharpRequire.resolve('@img/sharp-libvips-linux-x64/package'),
  );
  assert.equal(manifest.platform, `${process.platform}-${process.arch}-glibc`);
  const installed = await readJson(join(packageFile, 'package.json'));
  assert.equal(manifest.package, installed.name);
  assert.equal(manifest.packageVersion, installed.version);
  assert.deepEqual(
    manifest.versions,
    await readJson(join(packageFile, 'versions.json')),
  );
  assert.ok(
    sourceRows(manifest.sources).length >
      Object.keys(manifest.versions ?? {}).length,
  );
  assert.match(
    await readFile(
      join(root, 'tools/third-party/sharp-libvips-notices.txt'),
      'utf8',
    ),
    /Mozilla Public License 1.1/,
  );
});
