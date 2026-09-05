import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { root } from './workspace.mjs';

const compiler = resolve(root, 'node_modules/.bin/tsc');

/** @param {string[]} args */
const run = (args) =>
  spawnSync(compiler, args, { cwd: root, encoding: 'utf8' });

await test('a consumer keeps exact optional checks on generated request types', () => {
  // The client must emit its declarations first, because the fixture consumes
  // the package through a project reference.
  const build = run(['-b', 'packages/api-client/tsconfig.build.json']);
  assert.equal(
    build.status,
    0,
    `The API client build failed:\n${build.stdout}${build.stderr}`,
  );
  const check = run(['-p', 'tools/exact-optional/tsconfig.json']);
  const output = `${check.stdout}${check.stderr}`;
  assert.notEqual(
    check.status,
    0,
    `The fixture compiled. A consumer no longer enforces exact optional properties.\n${output}`,
  );
  assert.match(output, /error TS2375|error TS2379/);
});
