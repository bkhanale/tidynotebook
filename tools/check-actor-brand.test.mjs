import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { root } from './workspace.mjs';

const compiler = resolve(root, 'node_modules/.bin/tsc');

/** @param {string[]} args */
const run = (args) =>
  spawnSync(compiler, args, { cwd: root, encoding: 'utf8' });

await test('a plain object and a published link are no verified actor', () => {
  // Core must emit its declarations first, because the fixture consumes the
  // package through its public entry point.
  const build = run(['-b', 'packages/core/tsconfig.build.json']);
  assert.equal(
    build.status,
    0,
    `The core build failed:\n${build.stdout}${build.stderr}`,
  );
  const check = run(['-p', 'tools/actor-brand/tsconfig.json']);
  const output = `${check.stdout}${check.stderr}`;
  assert.notEqual(
    check.status,
    0,
    `The fixture compiled. A request body is now accepted as an actor.\n${output}`,
  );
  // The assignment, the permission call and the write of a published link all
  // report the missing marker, so the fixture must produce three errors that
  // name it.
  const errors = output.match(/error TS\d+/g) ?? [];
  assert.equal(
    errors.length,
    3,
    `Expected three type errors from the fixture:\n${output}`,
  );
  for (const code of errors) assert.match(code, /TS2739|TS2741|TS2345|TS2322/);
  assert.equal(output.match(/verifiedActorMark/g)?.length, 3, output);
});
