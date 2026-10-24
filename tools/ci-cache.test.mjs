import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildWithCache, imageCache } from './ci-cache.mjs';

const runtime = {
  ACTIONS_RUNTIME_TOKEN: 'test-runtime-token',
  ACTIONS_RESULTS_URL: 'https://cache.example.com',
  GITHUB_REPOSITORY: 'tidynotebook/tidynotebook',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'push',
  CACHE_WRITE: 'true',
};

test('only trusted main builds export separate architecture caches', () => {
  for (const arch of ['amd64', 'arm64']) {
    const cache = imageCache(arch, runtime);
    assert.deepEqual(cache.from, [
      `type=gha,version=2,scope=core-${arch},timeout=60s`,
    ]);
    assert.deepEqual(cache.to, [`${cache.from[0]},mode=max,ignore-error=true`]);
    for (const change of [
      { GITHUB_REF: 'refs/heads/topic' },
      { GITHUB_REF: 'refs/pull/12/merge', GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_REPOSITORY: 'contributor/fork' },
      { GITHUB_REF: 'refs/tags/v1.0.0' },
      { GITHUB_EVENT_NAME: 'pull_request_target' },
      { CACHE_WRITE: 'false' },
    ]) {
      const restore = imageCache(arch, { ...runtime, ...change });
      assert.deepEqual(restore.from, cache.from);
      assert.deepEqual(restore.to, []);
    }
  }
});

test('missing runtime auth and explicit disable select a cold build', () => {
  for (const change of [
    { ACTIONS_RUNTIME_TOKEN: '' },
    { ACTIONS_RESULTS_URL: '' },
    { CACHE_DISABLE: 'true' },
  ])
    assert.deepEqual(imageCache('amd64', { ...runtime, ...change }), {
      from: [],
      to: [],
    });
  assert.throws(() => imageCache('unknown', runtime));
});

test('cache failure retries with the same image arguments and no remote cache', () => {
  /** @type {string[][]} */
  const calls = [];
  const args = ['buildx', 'build', '--load', '--provenance=false', '.'];
  const cache = ['--cache-from', ...imageCache('arm64', runtime).from];
  const result = buildWithCache(
    args,
    (command) => {
      calls.push(command);
      return calls.length === 1 ? 1 : 0;
    },
    cache,
  );
  assert.equal(result, 0);
  assert.deepEqual(calls, [[...args, ...cache], args]);
  assert.equal(
    buildWithCache(args, () => 7, cache),
    7,
  );
  let attempts = 0;
  assert.equal(
    buildWithCache(args, () => ++attempts, []),
    1,
  );
  assert.equal(attempts, 1);
});

test('Compose inputs keep runtime tokens out of files and provide a cold retry', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'ci-image-'));
  try {
    const result = spawnSync(process.execPath, ['tools/ci-image.mjs'], {
      env: {
        ...process.env,
        ...runtime,
        RUNNER_TEMP: temporary,
        GITHUB_ENV: join(temporary, 'env'),
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const warm = readFileSync(join(temporary, 'ci-image.yaml'), 'utf8');
    assert.ok(warm.includes('scope=core-amd64'));
    assert.ok(warm.includes('ignore-error=true'));
    assert.ok(!warm.includes(runtime.ACTIONS_RUNTIME_TOKEN));
    assert.deepEqual(
      JSON.parse(readFileSync(join(temporary, 'ci-image-cold.yaml'), 'utf8'))
        .services.app.build,
      {
        platforms: ['linux/amd64'],
        cache_from: [],
        cache_to: [],
      },
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
