import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyImpact } from './ci-scope.mjs';
import { checkResults } from './ci-check.mjs';

await test('only named documents take the short path', () => {
  assert.equal(
    classifyImpact(['docs/guide/notes.md', 'README.md']).documentsOnly,
    true,
  );
  for (const path of [
    'unknown.md',
    'docs/example.mjs',
    'apps/docs/src/main.ts',
    '.github/workflows/ci.yml',
    'package.json',
  ])
    assert.equal(
      classifyImpact(['docs/guide/notes.md', path]).documentsOnly,
      false,
      path,
    );
  assert.equal(classifyImpact([]).documentsOnly, false);
});

await test('only image infrastructure selects image smoke', () => {
  for (const path of [
    'Dockerfile',
    '.dockerignore',
    'docker/entrypoint.sh',
    'tools/base-sources.json',
    'pnpm-lock.yaml',
    'patches/example.patch',
    'docker-compose.yml',
    'compose.local.yaml',
  ])
    assert.equal(classifyImpact([path]).image, true, path);
  for (const path of [
    'apps/server/src/main.ts',
    'packages/core/src/product.ts',
    'docs/README.md',
    '.github/workflows/ci.yml',
  ])
    assert.equal(classifyImpact([path]).image, false, path);
  assert.equal(
    classifyImpact(['.github/actions/setup/action.yml']).workflows,
    true,
  );
});

/** @param {boolean} source */
function results(source) {
  return {
    scope: {
      result: 'success',
      outputs: { source: String(source), image: 'false', workflows: 'false' },
    },
    static: { result: 'success' },
    unit: { result: source ? 'success' : 'skipped' },
    integration: { result: source ? 'success' : 'skipped' },
    image: { result: 'skipped' },
    workflows: { result: 'skipped' },
  };
}

await test('Check accepts correct skips and rejects missing, failed or cancelled jobs', () => {
  checkResults(results(false));
  checkResults(results(true));
  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    const jobs = results(true);
    jobs.unit.result = result;
    assert.throws(() => checkResults(jobs), /unit/);
  }
  const unexpected = results(false);
  unexpected.image.result = 'success';
  assert.throws(() => checkResults(unexpected), /image/);
  const invalid = results(false);
  invalid.scope.outputs.source = '';
  assert.throws(() => checkResults(invalid), /scope/);
  assert.throws(() => checkResults({}), /scope/);
});
