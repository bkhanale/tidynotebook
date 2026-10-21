import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { checkedImpact, classifyImpact, hasPassingCheck } from './ci-scope.mjs';
import { checkResults } from './ci-check.mjs';

await test('only named documents take the short path', () => {
  assert.equal(
    classifyImpact(['docs/design/notes.md', 'docs/audits/report.md'])
      .documentsOnly,
    true,
  );
  for (const path of [
    'unknown.md',
    'docs/guide/quickstart.md',
    'README.md',
    'AGENTS.md',
    'docs/development/verification.md',
    'docs/example.mjs',
    'apps/docs/src/main.ts',
    '.github/workflows/ci.yml',
    'package.json',
  ])
    assert.equal(
      classifyImpact(['docs/design/notes.md', path]).documentsOnly,
      false,
      path,
    );
  assert.equal(classifyImpact([]).documentsOnly, false);
});

await test('only image infrastructure selects image smoke', () => {
  for (const path of [
    'Dockerfile',
    'tests/image/commands.test.ts',
    '.github/actions/image/action.yml',
    'tools/ci-image.mjs',
    'package.json',
    'pnpm-workspace.yaml',
    '.node-version',
    '.npmrc',
    '.pnpmfile.cjs',
    'tools/runtime-dependencies.mjs',
    'tsconfig.base.json',
    'LICENSE',
    'README.md',
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
    image_main: { result: 'skipped' },
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

await test('only main selects the image job with write access', () => {
  const jobs = results(true);
  jobs.scope.outputs.image = 'true';
  jobs.image_main.result = 'success';
  checkResults(jobs, true);
  assert.throws(() => checkResults(jobs, false), /image/);
  jobs.image.result = 'success';
  jobs.image_main.result = 'skipped';
  checkResults(jobs, false);
  assert.throws(() => checkResults(jobs, true), /image/);
});

await test('only a successful Check from CI push or manual proof permits a short diff', () => {
  const base = 'a'.repeat(40);
  const checks = {
    check_runs: [
      {
        name: 'Check',
        head_sha: base,
        status: 'completed',
        conclusion: 'success',
        app: { id: 15368 },
        check_suite: { id: 71 },
      },
    ],
  };
  const workflow = {
    head_sha: base,
    path: '.github/workflows/ci.yml',
    event: 'push',
    check_suite_id: 71,
  };
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
    const passed = hasPassingCheck(
      { check_runs: [{ ...checks.check_runs[0], conclusion }] },
      base,
      { workflow_runs: [workflow] },
    );
    assert.equal(passed, false);
    assert.deepEqual(checkedImpact(['docs/design/note.md'], passed), {
      documentsOnly: false,
      image: true,
      workflows: true,
    });
  }
  assert.equal(hasPassingCheck({}, base, {}), false);
  for (const event of ['push', 'workflow_dispatch'])
    assert.equal(
      hasPassingCheck(checks, base, {
        workflow_runs: [{ ...workflow, event }],
      }),
      true,
    );
  for (const changed of [
    { event: 'pull_request' },
    { event: 'schedule' },
    { path: '.github/workflows/other.yml' },
    { head_sha: 'b'.repeat(40) },
    { check_suite_id: 72 },
  ])
    assert.equal(
      hasPassingCheck(checks, base, {
        workflow_runs: [{ ...workflow, ...changed }],
      }),
      false,
    );
  assert.equal(
    checkedImpact(['docs/design/note.md'], true).documentsOnly,
    true,
  );
  assert.equal(checkedImpact(null, true).documentsOnly, false);
});

await test('root build inputs copied by the Dockerfile select image smoke', () => {
  const dockerfile = readFileSync(
    new URL('../Dockerfile', import.meta.url),
    'utf8',
  );
  const rootInputs = [...dockerfile.matchAll(/^COPY (?!-)(.+) \.\/$/gm)]
    .flatMap((match) => (match[1] ?? '').split(' '))
    .filter((path) => !path.includes('/'));
  assert.ok(rootInputs.length > 0);
  for (const path of rootInputs)
    assert.equal(classifyImpact([path]).image, true, path);
});
