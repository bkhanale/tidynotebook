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
