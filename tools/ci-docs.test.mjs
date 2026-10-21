import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatterLock } from './ci-docs.mjs';
import { record } from './workspace.mjs';

await test('the document formatter keeps the version and integrity of the frozen lock', () => {
  const version = record(
    record(
      JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
      ),
    ).devDependencies,
  ).prettier;
  assert.ok(typeof version === 'string');
  const lock = formatterLock(
    version,
    readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'),
  );
  assert.equal(lock.packages['node_modules/prettier'].version, version);
  assert.match(lock.packages['node_modules/prettier'].integrity, /^sha512-/);
  assert.throws(() => formatterLock('latest', ''), /exact version/);
  assert.throws(() => formatterLock('3.9.9', ''), /integrity/);
});
