import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

await test('only trusted main builds export separate architecture caches', () => {
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

await test('missing runtime auth and explicit disable select a cold build', () => {
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

await test('cache failure retries with the same image arguments and no remote cache', () => {
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

await test('Compose inputs keep runtime tokens out of files and provide a cold retry', () => {
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

await test('the runtime action masks the token and exports only the cache runtime', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'cache-runtime-'));
  try {
    const environmentPath = join(temporary, 'env');
    const result = spawnSync(
      process.execPath,
      ['.github/actions/cache-runtime/index.mjs'],
      {
        env: { ...runtime, GITHUB_ENV: environmentPath },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      `::add-mask::${runtime.ACTIONS_RUNTIME_TOKEN}\n`,
    );
    assert.equal(
      readFileSync(environmentPath, 'utf8'),
      `ACTIONS_RUNTIME_TOKEN=${runtime.ACTIONS_RUNTIME_TOKEN}\nACTIONS_RESULTS_URL=${runtime.ACTIONS_RESULTS_URL}\n`,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

await test('the Compose command retries with only the cold override and keeps failure output', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'cache-compose-'));
  try {
    const calls = join(temporary, 'calls');
    writeFileSync(
      join(temporary, 'docker'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CACHE_TEST_CALLS"
case "$*" in
  *ci-image-cold.yaml*) exit "$CACHE_TEST_COLD_STATUS" ;;
  *) echo 'Original cache build failure' >&2; exit 1 ;;
esac
`,
      { mode: 0o700 },
    );
    for (const status of ['0', '9']) {
      writeFileSync(calls, '');
      const result = spawnSync(
        process.execPath,
        ['tools/ci-cache.mjs', 'compose'],
        {
          env: {
            ...process.env,
            ...runtime,
            PATH: temporary,
            RUNNER_TEMP: temporary,
            CACHE_TEST_CALLS: calls,
            CACHE_TEST_COLD_STATUS: status,
          },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, Number(status), result.stderr);
      assert.match(result.stderr, /Original cache build failure/);
      assert.match(result.stderr, /Retry without remote cache/);
      assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
        `compose -f docker-compose.yml -f ${temporary}/ci-image.yaml build`,
        `compose -f docker-compose.yml -f ${temporary}/ci-image-cold.yaml build`,
      ]);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
