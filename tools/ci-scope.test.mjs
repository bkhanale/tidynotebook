import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  checkedImpact,
  classifyImpact,
  hasPassingCheck,
  firstParentAncestors,
  provenPushBase,
  changedPaths,
} from './ci-scope.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    'tools/base-packages.json',
    'tools/distribution-target.mjs',
    'tools/third-party/fallbacks.json',
    'tools/third-party/debian-source-keys.gpg',
    'tools/workspace.mjs',
    'apps/server/package.json',
    'packages/core/package.json',
    'tools/sdk-codegen/package.json',
    'packages/ui/THIRD_PARTY_LICENSES.md',
    'tools/precompress-assets.mjs',
    'apps/web/vite.config.ts',
    'apps/server/tsconfig.build.json',
    'tests/image/commands.test.ts',
    '.github/actions/image/action.yml',
    '.github/workflows/release.yml',
    '.github/actions/publish-core/action.yml',
    '.github/actions/publish-core/nested/file.mjs',
    '.github/actions/build-core/action.yml',
    'tools/release-workflow.mjs',
    'tools/publish-core.mjs',
    'tools/download-core-artifacts.mjs',
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
    image_arm64: { result: 'skipped' },
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
  jobs.image_arm64.result = 'success';
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
  const manifests = [
    ...dockerfile.matchAll(/^COPY ([^ ]+\/package\.json) /gm),
  ].map((match) => match[1] ?? '');
  for (const path of [
    ...rootInputs,
    ...manifests,
    'tools/base-packages.json',
    'tools/third-party/fallbacks.json',
    'tools/workspace.mjs',
    'packages/ui/THIRD_PARTY_LICENSES.md',
  ])
    assert.equal(classifyImpact([path]).image, true, path);
});

await test('push proof skips cancelled ancestors and selects the nearest success', async () => {
  const ancestors = ['a', 'b', 'c'].map((value) => value.repeat(40));
  /** @type {string[]} */
  const visited = [];
  const base = await provenPushBase(ancestors, async (sha) => {
    visited.push(sha);
    return sha !== ancestors[0];
  });
  assert.equal(base, ancestors[1]);
  assert.deepEqual(visited, ancestors.slice(0, 2));
});

await test('push proof is bounded and fails closed on missing or failed access', async () => {
  const ancestors = Array.from({ length: 21 }, (_, index) =>
    index.toString(16).padStart(40, '0'),
  );
  /** @type {string[]} */
  const visited = [];
  assert.equal(
    await provenPushBase(ancestors, async (sha) => {
      visited.push(sha);
      return sha === ancestors[20];
    }),
    undefined,
  );
  assert.equal(visited.length, 20);
  assert.equal(await provenPushBase([], async () => true), undefined);
  assert.equal(await provenPushBase(['invalid'], async () => true), undefined);
  assert.equal(
    await provenPushBase(ancestors, async () => {
      throw new Error('API unavailable');
    }),
    undefined,
  );
  assert.deepEqual(checkedImpact(null, false), {
    documentsOnly: false,
    image: true,
    workflows: true,
  });
});

await test('first-parent history excludes merged side commits and carries source changes', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'scope-history-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  /** @param {string[]} args */
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-m', 'test: base');
  const proven = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'side');
  git('commit', '--allow-empty', '-m', 'test: side');
  const side = git('rev-parse', 'HEAD');
  git('checkout', 'main');
  writeFileSync(join(cwd, 'source.ts'), 'changed');
  git('add', '.');
  git('commit', '-m', 'test: source');
  git('merge', '--no-ff', 'side', '-m', 'test: merge');
  writeFileSync(join(cwd, 'note.md'), 'document');
  git('add', '.');
  git('commit', '-m', 'docs: note');
  const ancestors = firstParentAncestors(cwd);
  assert.equal(ancestors.includes(side), false);
  const base = await provenPushBase(ancestors, async (sha) => sha === proven);
  assert.equal(base, proven);
  const paths = git('diff', '--name-only', base ?? '', 'HEAD').split('\n');
  assert.ok(paths.includes('source.ts'));
  assert.equal(checkedImpact(paths, true).documentsOnly, false);
  for (let index = 0; index < 22; index++)
    git('commit', '--allow-empty', '-m', 'docs: extra');
  assert.equal(firstParentAncestors(cwd).length, 20);
  assert.equal(firstParentAncestors(cwd).includes(proven), false);
  assert.equal(changedPaths('f'.repeat(40)), null);
});

await test('document checks use the complete proven diff and the fork guard stays in place', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  assert.ok(workflow.includes('DOCS_BASE: ${{ needs.scope.outputs.base }}'));
  assert.ok(
    workflow.includes(
      "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name != github.repository",
    ),
  );
});
