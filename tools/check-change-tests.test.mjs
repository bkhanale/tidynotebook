import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  areaOf,
  exemptions,
  isSource,
  isTest,
  untestedAreas,
} from './check-change-tests.mjs';

const checker = fileURLToPath(
  new URL('./check-change-tests.mjs', import.meta.url),
);

await test('a path belongs to its package, the tools or the tests', () => {
  assert.equal(areaOf('apps/web/src/lib/breadcrumb.ts'), 'apps/web');
  assert.equal(areaOf('packages/ui/src/icons.tsx'), 'packages/ui');
  assert.equal(areaOf('tools/sdk-codegen/src/emit.ts'), 'tools/sdk-codegen');
  assert.equal(areaOf('tools/check-docs.mjs'), 'tools');
  assert.equal(areaOf('tools/performance/service.ts'), 'tools');
  assert.equal(areaOf('tests/integration/trash.test.ts'), 'tests');
  assert.equal(areaOf('README.md'), null);
  assert.equal(areaOf('docker/healthcheck.mjs'), null);
  assert.equal(areaOf('apps/README.md'), null);
});

await test('a test is a test file or a file of the tests tree', () => {
  assert.equal(isTest('apps/web/src/lib/breadcrumb.test.ts'), true);
  assert.equal(isTest('tools/check-docs.test.mjs'), true);
  assert.equal(isTest('tests/integration/support/server.ts'), true);
  assert.equal(isTest('apps/web/src/lib/breadcrumb.ts'), false);
  assert.equal(isTest('tests/AGENTS.md'), false);
});

await test('source is code that is no test, declaration or output', () => {
  assert.equal(isSource('apps/web/src/lib/breadcrumb.ts'), true);
  assert.equal(isSource('apps/web/src/shell/shell.tsx'), true);
  assert.equal(isSource('tools/check-docs.mjs'), true);
  assert.equal(isSource('apps/web/src/lib/breadcrumb.test.ts'), false);
  assert.equal(isSource('packages/core/src/types.d.ts'), false);
  assert.equal(isSource('packages/api-client/src/generated/sdk.gen.ts'), false);
  assert.equal(isSource('apps/docs/dist/site/assets/docs.js'), false);
  assert.equal(isSource('apps/web/src/tailwind.css'), false);
  assert.equal(isSource('docs/guide/README.md'), false);
  assert.equal(isSource('tests/integration/support/server.ts'), false);
});

await test('a changed test of the area covers its source', () => {
  const result = untestedAreas([
    'apps/web/src/lib/breadcrumb.ts',
    'apps/web/src/lib/breadcrumb.test.ts',
  ]);
  assert.deepEqual(result, { untested: [], excused: [] });
});

await test('source with no test of its area is refused', () => {
  const result = untestedAreas([
    'apps/web/src/lib/breadcrumb.ts',
    'packages/ui/src/icons.test.ts',
    'docs/guide/README.md',
  ]);
  assert.deepEqual(result.untested, [
    { area: 'apps/web', files: ['apps/web/src/lib/breadcrumb.ts'] },
  ]);
});

await test('an integration test covers every package and no tool', () => {
  const result = untestedAreas([
    'apps/server/src/routes/published.ts',
    'packages/core/src/notes/name.ts',
    'tools/check-docs.mjs',
    'tests/integration/published-page.test.ts',
  ]);
  assert.deepEqual(result.untested, [
    { area: 'tools', files: ['tools/check-docs.mjs'] },
  ]);
});

await test('a change with no source needs no test', () => {
  const result = untestedAreas([
    'docs/guide/README.md',
    'apps/web/src/tailwind.css',
    'package.json',
  ]);
  assert.deepEqual(result, { untested: [], excused: [] });
});

await test('a trailer with a reason excuses its area', () => {
  const { exempt, failures } = exemptions(
    'fix(web): move a label\n\nTest-exempt: apps/web the label is copy only\n',
  );
  assert.deepEqual(failures, []);
  const result = untestedAreas(['apps/web/src/shell/shell.tsx'], exempt);
  assert.deepEqual(result, {
    untested: [],
    excused: [{ area: 'apps/web', reason: 'the label is copy only' }],
  });
});

await test('a trailer with no reason excuses nothing', () => {
  const { exempt, failures } = exemptions(
    'chore: x\n\nTest-exempt: apps/web\n',
  );
  assert.equal(exempt.size, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0] ?? '', /states no reason/);
  const empty = exemptions('chore: x\n\nTest-exempt:\n');
  assert.match(empty.failures[0] ?? '', /states no area/);
});

/**
 * A disposable repository with one commit on `main` and a branch on top.
 *
 * @returns {string}
 */
function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'notesapp-change-tests-'));
  /** @param {string[]} args */
  const run = (...args) =>
    execFileSync('git', args, { cwd: directory, stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  run('config', 'commit.gpgsign', 'false');
  write(directory, 'README.md', '# Fixture\n');
  run('add', '.');
  run('commit', '-q', '-m', 'chore: start');
  run('switch', '-q', '-c', 'change');
  return directory;
}

/** @param {string} directory @param {string} path @param {string} text */
function write(directory, path, text) {
  const file = join(directory, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * @param {string} directory
 * @param {string[]} [args]
 * @param {string} [input]
 */
function check(directory, args = [], input = '') {
  const result = spawnSync(
    process.execPath,
    [checker, ...args, '--root', directory],
    { encoding: 'utf8', input },
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    stdout: result.stdout,
  };
}

await test('the check refuses uncommitted source with no test', (t) => {
  const directory = repository();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  write(directory, 'apps/web/src/lib/name.ts', 'export const a = 1;\n');
  const refused = check(directory);
  assert.equal(refused.status, 1);
  assert.match(refused.output, /apps\/web\n {4}apps\/web\/src\/lib\/name\.ts/);
  write(directory, 'apps/web/src/lib/name.test.ts', 'export {};\n');
  const accepted = check(directory);
  assert.equal(accepted.status, 0, accepted.output);
});

await test('the check reads the trailer of a commit of the branch', (t) => {
  const directory = repository();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  write(directory, 'apps/web/src/shell/shell.tsx', 'export {};\n');
  execFileSync('git', ['add', '.'], { cwd: directory });
  execFileSync(
    'git',
    [
      'commit',
      '-q',
      '-m',
      'fix(web): move a label\n\nTest-exempt: apps/web the label is copy only',
    ],
    { cwd: directory },
  );
  const result = check(directory);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /apps\/web has no test because the label/);
});

await test('the hook blocks one stop and gives way on the next', (t) => {
  const directory = repository();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  write(directory, 'packages/ui/src/icons.tsx', 'export {};\n');
  const first = check(directory, ['--hook'], '{"stop_hook_active":false}');
  assert.equal(first.status, 0);
  /** @type {unknown} */
  const answer = JSON.parse(first.stdout);
  assert.equal(Reflect.get(Object(answer), 'decision'), 'block');
  assert.match(String(Reflect.get(Object(answer), 'reason')), /packages\/ui/);
  const second = check(directory, ['--hook'], '{"stop_hook_active":true}');
  assert.equal(second.status, 0);
  assert.equal(second.stdout, '');
});

await test('a checkout with no main passes with a notice', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'notesapp-change-tests-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'other'], { cwd: directory });
  const result = check(directory);
  assert.equal(result.status, 0);
  assert.match(result.output, /no main branch/);
});
