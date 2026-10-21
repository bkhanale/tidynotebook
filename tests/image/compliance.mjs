/** Runs inside the built runner with no network access. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/** @param {string} file */
async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
assert.equal(process.platform, 'linux');
assert.ok(['x64', 'arm64'].includes(process.arch));
const arch = process.arch;
const require = createRequire('/app/server/package.json');
const sharpRequire = createRequire(require.resolve('sharp'));
const name = `@img/sharp-libvips-linux-${arch}`;
const pkg = sharpRequire(`${name}/package`);
const native = await json('/app/licenses/native-source/manifest.json');
assert.equal(native.package, name);
assert.equal(native.packageVersion, pkg.version);
assert.equal(native.platform, `linux-${arch}-glibc`);
assert.deepEqual(native.versions, sharpRequire(`${name}/versions`));
for (const folder of ['native-source', 'base-source', 'runner-source']) {
  const manifest = await json(`/app/licenses/${folder}/manifest.json`);
  assert.ok(manifest.sources.length > 0);
  for (const row of manifest.sources) {
    assert.match(row.file, /^[\w.+~-]+$/);
    const bytes = await readFile(`/app/licenses/${folder}/${row.file}`);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      row.sha256,
      row.file,
    );
  }
}
const original = await json('/app/licenses/base-source/original-binaries.json');
const runner = await json('/app/licenses/runner-source/manifest.json');
const base = await json('/app/licenses/base-source/manifest.json');
assert.equal(original.image, base.image);
assert.equal(runner.image, base.image);
assert.equal(process.versions.node, base.nodeVersion);
const expected = new Map(original.packages.map((row) => [row.name, row]));
for (const row of runner.binaries) {
  assert.ok(expected.has(row.name));
  expected.set(row.name, row);
}
const installed = execFileSync(
  'dpkg-query',
  [
    '-W',
    '-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n',
  ],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n');
assert.equal(installed.length, expected.size);
for (const line of installed) {
  const [binary, version, sourcePackage, sourceVersion] = line.split('\t');
  assert.deepEqual(expected.get(binary), {
    name: binary,
    version,
    sourcePackage,
    sourceVersion,
  });
  assert.ok(
    base.packages.some(
      (row) => row.name === sourcePackage && row.version === sourceVersion,
    ) ||
      runner.packages.some(
        (row) => row.name === sourcePackage && row.version === sourceVersion,
      ),
  );
}
for (const folder of [
  '/app/licenses',
  '/app/licenses/base-npm',
  '/app/web/dist/web/licenses',
]) {
  const inventory = await json(`${folder}/inventory.json`);
  const combined = await readFile(`${folder}/THIRD-PARTY-NOTICES.txt`, 'utf8');
  assert.ok(inventory.packages.length > 0);
  for (const row of inventory.packages) {
    assert.ok(row.notices.length > 0, row.name);
    for (const notice of row.notices) {
      assert.ok(notice.text.trim().length > 0, row.name);
      assert.ok(combined.includes(notice.text), row.name);
    }
  }
  if (folder === '/app/licenses') {
    const library = inventory.packages.find((row) => row.name === name);
    assert.equal(library?.version, pkg.version);
    assert.equal(library?.license, 'LGPL-3.0-or-later');
    const reviewed = await readFile(
      `${folder}/borrowed-work/sharp-libvips-notices.txt`,
      'utf8',
    );
    assert.ok(library.notices.some((notice) => notice.text === reviewed));
  }
}
process.stdout.write(`Distribution sources and notices pass: linux/${arch}\n`);
