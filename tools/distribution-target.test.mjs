import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { dependencyNotices } from './distribution-notices.mjs';
import {
  distributionArchitecture,
  distributionManifest,
  validateNativeConsumer,
} from './distribution-target.mjs';
import { readJson, record, root } from './workspace.mjs';

await test('reviewed targets preserve amd64 bytes and change only arm64 identities', async () => {
  for (const file of [
    'native-sources.json',
    'base-packages.json',
    'runner-sources.json',
    'base-sources.json',
  ]) {
    const path = join(root, 'tools', file);
    const baseline = await readJson(path);
    const amd64 = await distributionManifest(path, 'x64');
    assert.equal(
      JSON.stringify(amd64, null, 2) + '\n',
      JSON.stringify(baseline, null, 2) + '\n',
    );
    const arm64 = await distributionManifest(path, 'arm64');
    /** @type {unknown} */
    const expected = JSON.parse(
      JSON.stringify(baseline)
        .replaceAll(':amd64', ':arm64')
        .replaceAll('linux-x64', 'linux-arm64'),
    );
    assert.deepEqual(arm64, expected);
  }
  for (const architecture of ['amd64', 's390x', 'arm', 'unknown', ''])
    assert.throws(() => distributionArchitecture(architecture), /Unsupported/);
  await validateNativeConsumer(join(root, 'apps/server'), 'x64');
});

await test('both native targets bind the complete library version map and refuse changes', async () => {
  const directory = await mkdtemp(join(root, '.tooling/native-consumer-'));
  try {
    for (const arch of ['x64', 'arm64']) {
      const name = `@img/sharp-libvips-linux-${arch}`;
      const library = join(directory, 'node_modules', name);
      const sharp = join(directory, 'node_modules/sharp');
      await mkdir(library, { recursive: true });
      await mkdir(sharp, { recursive: true });
      await writeFile(
        join(sharp, 'package.json'),
        JSON.stringify({ name: 'sharp', main: 'index.cjs' }),
      );
      await writeFile(join(sharp, 'index.cjs'), 'module.exports = {};');
      const manifest = await distributionManifest(
        join(root, 'tools/native-sources.json'),
        arch,
      );
      const exports = {
        './package': './package.json',
        './versions': './versions.json',
      };
      await writeFile(
        join(library, 'package.json'),
        JSON.stringify({ name, version: manifest.packageVersion, exports }),
      );
      await writeFile(
        join(library, 'versions.json'),
        JSON.stringify(manifest.versions),
      );
      await validateNativeConsumer(directory, arch);
      // Use a fresh require path for each mismatch, so Node cannot reuse JSON.
      const wrong = join(directory, `wrong-${arch}`);
      await mkdir(join(wrong, 'node_modules', name), { recursive: true });
      await mkdir(join(wrong, 'node_modules/sharp'), { recursive: true });
      await writeFile(
        join(wrong, 'node_modules/sharp/package.json'),
        JSON.stringify({ main: 'index.cjs' }),
      );
      await writeFile(
        join(wrong, 'node_modules/sharp/index.cjs'),
        'module.exports = {};',
      );
      await writeFile(
        join(wrong, 'node_modules', name, 'package.json'),
        JSON.stringify({ name, version: '0.0.0', exports }),
      );
      await writeFile(
        join(wrong, 'node_modules', name, 'versions.json'),
        JSON.stringify(manifest.versions),
      );
      await assert.rejects(
        validateNativeConsumer(wrong, arch),
        /does not match/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('arm64 notice fallbacks require the reviewed version, source and terms', async () => {
  const directory = await mkdtemp(join(root, '.tooling/arm64-notices-'));
  try {
    const fallbacks = await readJson(
      join(root, 'tools/third-party/fallbacks.json'),
    );
    for (const name of [
      '@img/sharp-libvips-linux-arm64',
      '@pagefind/linux-arm64',
    ]) {
      const fallback = record(fallbacks[name]);
      const versions = fallback.versions;
      assert.ok(Array.isArray(versions));
      const pkg = {
        name,
        version: String(versions[0]),
        repository: fallback.repository,
        license: fallback.license,
      };
      const baseline = { ...pkg };
      for (const change of [
        {},
        { version: '0.0.0' },
        { license: 'MIT-0' },
        { repository: 'https://example.com' },
      ]) {
        await writeFile(
          join(directory, 'package.json'),
          JSON.stringify({ ...baseline, ...change }),
        );
        if (Object.keys(change).length === 0) {
          const notices = await dependencyNotices(directory);
          assert.equal(
            notices[0]?.notices[0]?.text,
            await readFile(
              join(root, 'tools/third-party', String(fallback.file)),
              'utf8',
            ),
          );
        } else
          await assert.rejects(dependencyNotices(directory), /does not match/);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
