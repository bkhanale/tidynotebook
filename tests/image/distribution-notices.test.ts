/** Check the actual image on each native CI runner. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await test('the image has complete target sources and notices', async () => {
  const source = await readFile(
    new URL('./compliance.mjs', import.meta.url),
    'utf8',
  );
  const output = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--network=none',
      '--entrypoint=node',
      process.env['NOTESAPP_IMAGE'] || 'notesapp:latest',
      '--input-type=module',
      '-e',
      source,
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  assert.match(output, /Distribution sources and notices pass/);
});

await test('the original binary record matches the pinned base before runner changes', () => {
  const image = process.env['NOTESAPP_IMAGE'] || 'notesapp:latest';
  const args = ['run', '--rm', '--network=none', '--entrypoint=node', image];
  const base = execFileSync(
    'docker',
    [
      ...args,
      '-p',
      'JSON.parse(require("fs").readFileSync("/app/licenses/base-source/original-binaries.json")).image',
    ],
    { encoding: 'utf8' },
  ).trim();
  assert.match(base, /^node:[\w.-]+@sha256:[a-f0-9]{64}$/);
  const expected = execFileSync(
    'docker',
    [
      ...args,
      '-p',
      'JSON.parse(require("fs").readFileSync("/app/licenses/base-source/original-binaries.json")).packages.map(p => [p.name,p.version,p.sourcePackage,p.sourceVersion].join("\\t")).sort().join("\\n")',
    ],
    { encoding: 'utf8' },
  ).trim();
  const actual = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--network=none',
      '--entrypoint=dpkg-query',
      base,
      '-W',
      '-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n',
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .sort()
    .join('\n');
  assert.equal(actual, expected);
});
