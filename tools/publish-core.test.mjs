import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { root } from './workspace.mjs';

/** Run the publication procedure with command and registry substitutes.
 * @param {import('node:test').TestContext} context
 * @param {Record<string, string>} overrides */
async function publication(context, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'core-publication-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, 'calls');
  const executable = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const sha = 'a'.repeat(40);
if (process.argv[1].endsWith('/gh')) console.log(process.env.STALE ? 'b'.repeat(40) : sha);
else if (process.argv[1].endsWith('/skopeo')) { if (args[0] === 'inspect') console.log(JSON.stringify({ schemaVersion: 2, source: args.at(-1) })); }
else if (args[0] === 'image') {
 const arch = args.at(-1).split(':')[1];
 console.log(JSON.stringify([{ Os: 'linux', Architecture: arch, Config: { Labels: {
  'org.opencontainers.image.revision': process.env.BAD_ARM && arch === 'arm64' ? 'b'.repeat(40) : sha,
  'org.opencontainers.image.source': 'https://github.com/tidynotebook/tidynotebook',
  'org.opencontainers.image.version': process.env.VERSION
 } } }]));
} else if (args.includes('inspect')) console.log('sha256:' + '2'.repeat(64));
`;
  for (const command of ['docker', 'gh', 'skopeo'])
    await writeFile(join(directory, command), executable, { mode: 0o700 });
  const shim = join(directory, 'registry.mjs');
  await writeFile(
    shim,
    `globalThis.fetch = async (url) => {
    if (String(url).includes('/token?')) return Response.json({ token: 'fake' });
    return process.env.EXISTS ? Response.json({}, { status: 200 }) : Response.json({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }, { status: 404 });
  };`,
  );
  const result = spawnSync(
    process.execPath,
    ['--import', shim, join(root, 'tools/publish-core.mjs')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        CALLS: log,
        RUNNER_TEMP: directory,
        GITHUB_REPOSITORY: 'tidynotebook/tidynotebook',
        GITHUB_REF: 'refs/heads/main',
        VERSION: 'main',
        SOURCE_SHA: 'a'.repeat(40),
        GITHUB_RUN_ID: '100',
        GITHUB_RUN_ATTEMPT: '1',
        GH_TOKEN: 'fake',
        GITHUB_OUTPUT: join(directory, 'output'),
        GITHUB_STEP_SUMMARY: join(directory, 'summary'),
        ...overrides,
      },
    },
  );
  const calls = await readFile(log, 'utf8').catch(() => '');
  return {
    ...result,
    calls,
    output: await readFile(join(directory, 'output'), 'utf8').catch(() => ''),
  };
}

await test('publication loads and checks both proved archives without rebuilding', async (context) => {
  const result = await publication(context);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.match(/"load"/g)?.length, 2);
  assert.equal(
    result.calls.match(/docker:\/\/ghcr.io\/tidynotebook\/core@sha256:/g)
      ?.length,
    2,
  );
  assert.equal(result.calls.match(/"--preserve-digests"/g)?.length, 2);
  assert.doesNotMatch(result.calls, /"push"|"tag"|:build-/);
  assert.ok(
    result.calls.lastIndexOf('"load"') < result.calls.indexOf('docker://'),
  );
  assert.match(
    result.calls,
    /"imagetools","create","--tag","ghcr.io\/tidynotebook\/core:main"/,
  );
  assert.doesNotMatch(result.calls, /"build"|"run"/);
  assert.equal(result.output, `digest=sha256:${'2'.repeat(64)}\n`);
});

await test('a wrong archive stops before any registry write', async (context) => {
  const result = await publication(context, { BAD_ARM: '1' });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.calls, /docker:\/\/|"create"/);
});

await test('a late main run cannot move the main alias', async (context) => {
  const result = await publication(context, { STALE: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /A newer main commit exists/);
  assert.doesNotMatch(result.calls, /"create"/);
});

await test('an existing fixed version stops before any image write', async (context) => {
  const result = await publication(context, {
    GITHUB_REF: 'refs/tags/v1.2.3',
    VERSION: '1.2.3',
    EXISTS: '1',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Fixed versions cannot be replaced/);
  assert.equal(result.calls, '');
});
