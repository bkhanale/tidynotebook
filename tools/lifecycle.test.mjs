import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  prove,
  reviewGate,
  readPull,
  cleanReviewBody,
  land,
  prepareReview,
  parseLifecycle,
} from './lifecycle.mjs';
import {
  digest,
  git,
  lock,
  readState,
  save,
  snapshot,
  stateDirectory,
  validProof,
} from './lifecycle-state.mjs';
import {
  nextVersion,
  releaseChange,
  releaseEntry,
  release,
} from './release.mjs';
import {
  parseManifest,
  operatorDigests,
  migrationMetadata,
  publishedRelease,
} from './release-manifest.mjs';
import { coreReadingList, diffImpact } from './agent-context.mjs';
import { prepare } from './task-prepare.mjs';
import { record, root } from './workspace.mjs';
import { main as releaseCheck } from './release-check.mjs';

/** A real Git repository with isolated command executables, not a fake Git API. */
function fixture() {
  mkdirSync(join(root, '.tooling'), { recursive: true });
  const cwd = mkdtempSync(join(root, '.tooling/lifecycle-test-'));
  mkdirSync(join(cwd, 'tools'), { recursive: true });
  mkdirSync(join(cwd, '.tooling/bin'), { recursive: true });
  for (const name of [
    'lifecycle-state.mjs',
    'lifecycle.mjs',
    'release.mjs',
    'release-manifest.mjs',
  ])
    copyFileSync(join(root, 'tools', name), join(cwd, 'tools', name));
  writeFileSync(join(cwd, '.gitignore'), '.tooling/\n');
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({
      scripts: { verify: 'node gate.mjs', 'test:image': 'node gate.mjs' },
    }),
  );
  writeFileSync(
    join(cwd, 'gate.mjs'),
    `import {readFileSync,writeFileSync} from 'node:fs';
let n=0;try{n=Number(readFileSync('.tooling/count','utf8'));}catch{}
writeFileSync('.tooling/count',String(n+1));
console.log('The fixture gate runs.');
if(process.env.NOTESAPP_IMAGE)writeFileSync('.tooling/tested-image',process.env.NOTESAPP_IMAGE);
if(process.env.NOTESAPP_TEST_GATE_MODE==='fail')process.exit(1);
if(process.env.NOTESAPP_TEST_GATE_MODE==='mutate')writeFileSync('source.txt','changed');
`,
  );
  writeFileSync(
    join(cwd, '.tooling/bin/pnpm'),
    `#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
if(process.argv[2]==='--version')console.log('12.3.4');
else process.exit(spawnSync(process.execPath,['gate.mjs'],{stdio:'inherit'}).status??1);
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(cwd, '.tooling/bin/docker'),
    `#!/usr/bin/env node
import {appendFileSync,existsSync} from 'node:fs';
if(process.argv[2]==='build'){
const context=process.argv.at(-1);if(!existsSync(context+'/source.txt'))process.exit(1);
appendFileSync('.tooling/builds','build\\n');
}else console.log('sha256:'+'b'.repeat(64));
`,
    { mode: 0o700 },
  );
  writeFileSync(join(cwd, 'source.txt'), 'original');
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test']);
  git(cwd, ['config', 'commit.gpgsign', 'false']);
  git(cwd, ['config', 'tag.gpgsign', 'false']);
  git(cwd, ['remote', 'add', 'origin', 'https://github.com/example/core']);
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', 'feat: fixture']);
  const oldPath = process.env.PATH;
  process.env.PATH = join(cwd, '.tooling/bin') + ':' + oldPath;
  return {
    cwd,
    cleanup() {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      delete process.env.NOTESAPP_TEST_GATE_MODE;
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

await test('proof runs real subprocesses, caches exact input, and rejects a changed log', () => {
  const f = fixture();
  try {
    const first = prove(f.cwd);
    assert.equal(first.result, 'passed');
    assert.equal(readFileSync(join(f.cwd, '.tooling/count'), 'utf8'), '1');
    prove(f.cwd);
    assert.equal(readFileSync(join(f.cwd, '.tooling/count'), 'utf8'), '1');
    const results = Array.isArray(first.gateResults) ? first.gateResults : [];
    assert.equal(results.length, 1);
    const entry = record(results[0]);
    assert.equal(typeof entry, 'object');
    writeFileSync(
      join(
        stateDirectory(f.cwd),
        `verify-${git(f.cwd, ['rev-parse', 'HEAD'])}.log`,
      ),
      'different',
    );
    assert.equal(validProof(first, snapshot(f.cwd), ['verify'], f.cwd), false);
    prove(f.cwd);
    assert.equal(readFileSync(join(f.cwd, '.tooling/count'), 'utf8'), '2');
    git(f.cwd, [
      'remote',
      'set-url',
      'origin',
      'https://github.com/example/other',
    ]);
    assert.equal(validProof(first, snapshot(f.cwd), ['verify'], f.cwd), false);
  } finally {
    f.cleanup();
  }
});
await test('failure or mutation during a gate never saves passing proof', () => {
  for (const mode of ['fail', 'mutate']) {
    const f = fixture();
    try {
      process.env.NOTESAPP_TEST_GATE_MODE = mode;
      assert.throws(
        () => prove(f.cwd),
        mode === 'fail' ? /gate fails/ : /pending files|inputs change/,
      );
      assert.deepEqual(
        readState(join(stateDirectory(f.cwd), 'proof.json')),
        {},
      );
      assert.ok(
        readFileSync(
          join(
            stateDirectory(f.cwd),
            `verify-${git(f.cwd, ['rev-parse', 'HEAD'])}.log`,
          ),
          'utf8',
        ).includes('fixture'),
      );
    } finally {
      f.cleanup();
    }
  }
});
await test('image proof builds the exact archived commit and uses its image', () => {
  const f = fixture();
  try {
    const proof = prove(f.cwd, ['verify', 'test:image']);
    assert.equal(
      validProof(proof, snapshot(f.cwd), ['verify', 'test:image'], f.cwd),
      true,
    );
    assert.equal(
      readFileSync(join(f.cwd, '.tooling/builds'), 'utf8'),
      'build\n',
    );
    assert.equal(readFileSync(join(f.cwd, '.tooling/count'), 'utf8'), '2');
    assert.equal(
      readFileSync(join(f.cwd, '.tooling/tested-image'), 'utf8'),
      'sha256:' + 'b'.repeat(64),
    );
    prove(f.cwd, ['verify', 'test:image']);
    assert.equal(
      readFileSync(join(f.cwd, '.tooling/builds'), 'utf8'),
      'build\n',
    );
  } finally {
    f.cleanup();
  }
});
await test('one repository lock excludes another worktree and is not removed by its caller', () => {
  const f = fixture();
  const other = join(f.cwd, '.tooling/other');
  try {
    git(f.cwd, ['worktree', 'add', '-b', 'change', other]);
    const unlock = lock(f.cwd, 'release');
    assert.throws(() => lock(other, 'release'), /lock exists/);
    unlock();
    lock(other, 'release')();
  } finally {
    f.cleanup();
  }
});
await test('proof locks allow independent worktrees while landing stays shared', () => {
  const f = fixture();
  const other = join(f.cwd, '.tooling/other');
  try {
    git(f.cwd, ['worktree', 'add', '-b', 'change', other]);
    const first = lock(f.cwd, 'proof');
    try {
      lock(other, 'proof')();
      assert.throws(() => lock(f.cwd, 'proof'), /lock exists/);
    } finally {
      first();
    }
    const landing = lock(f.cwd, 'land');
    try {
      assert.throws(() => lock(other, 'land'), /lock exists/);
    } finally {
      landing();
    }
  } finally {
    f.cleanup();
  }
});
await test('a demonstrably dead lock owner is recovered and a live owner refuses recovery', () => {
  const f = fixture();
  try {
    execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import {lock} from ${JSON.stringify(new URL('./lifecycle-state.mjs', import.meta.url).href)};lock(${JSON.stringify(f.cwd)},'release');`,
    ]);
    const unlock = lock(f.cwd, 'release');
    try {
      assert.throws(() => lock(f.cwd, 'release'), /lock exists/);
    } finally {
      unlock();
    }
  } finally {
    f.cleanup();
  }
});
await test('a proof ignores pnpm invocation metadata but binds real configuration', () => {
  const f = fixture();
  const oldName = process.env.PNPM_PACKAGE_NAME;
  const oldScript = process.env.PNPM_SCRIPT_SRC_DIR;
  const oldStore = process.env.PNPM_STORE_DIR;
  try {
    delete process.env.PNPM_PACKAGE_NAME;
    delete process.env.PNPM_SCRIPT_SRC_DIR;
    const direct = snapshot(f.cwd);
    process.env.PNPM_PACKAGE_NAME = 'notesapp';
    process.env.PNPM_SCRIPT_SRC_DIR = f.cwd;
    const invoked = prove(f.cwd, ['verify', 'test:image']);
    assert.equal(invoked.inputDigest, direct.inputDigest);
    delete process.env.PNPM_PACKAGE_NAME;
    delete process.env.PNPM_SCRIPT_SRC_DIR;
    assert.equal(
      validProof(invoked, snapshot(f.cwd), ['verify', 'test:image'], f.cwd),
      true,
    );
    prove(f.cwd, ['verify', 'test:image']);
    assert.equal(
      readFileSync(join(f.cwd, '.tooling/builds'), 'utf8'),
      'build\n',
    );
    process.env.PNPM_STORE_DIR = '/different/store';
    assert.notEqual(snapshot(f.cwd).inputDigest, direct.inputDigest);
  } finally {
    if (oldName === undefined) delete process.env.PNPM_PACKAGE_NAME;
    else process.env.PNPM_PACKAGE_NAME = oldName;
    if (oldScript === undefined) delete process.env.PNPM_SCRIPT_SRC_DIR;
    else process.env.PNPM_SCRIPT_SRC_DIR = oldScript;
    if (oldStore === undefined) delete process.env.PNPM_STORE_DIR;
    else process.env.PNPM_STORE_DIR = oldStore;
    f.cleanup();
  }
});
await test('clean reviews accept the known sentence with a variable same-line ending', () => {
  for (const ending of [
    'Swish!',
    'Breezy!',
    'What shall we delve into next?',
  ]) {
    assert.equal(
      cleanReviewBody(`Didn't find any major issues. ${ending}`),
      true,
    );
  }
  assert.equal(cleanReviewBody('Completed summary with a thumbs up.'), false);
  assert.equal(
    cleanReviewBody("Didn't find any major issues. P2: stale data"),
    false,
  );
});
await test('the release before gate reports unsafe proof inputs without a build fallback', () => {
  for (const mode of ['dirty', 'docker']) {
    const f = fixture();
    try {
      if (mode === 'dirty') writeFileSync(join(f.cwd, 'source.txt'), 'pending');
      else
        writeFileSync(
          join(f.cwd, '.tooling/bin/docker'),
          '#!/bin/sh\nexit 1\n',
          { mode: 0o700 },
        );
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {main} from ${JSON.stringify(new URL('./release-check.mjs', import.meta.url).href)};process.exitCode=await main('before','0.4.0',${JSON.stringify(f.cwd)});`,
        ],
        { cwd: f.cwd, encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stderr, '');
      assert.match(
        result.stdout,
        mode === 'dirty'
          ? /Commit the pending files/
          : /Docker cannot be checked/,
      );
      assert.equal(existsSync(join(f.cwd, '.tooling/builds')), false);
    } finally {
      f.cleanup();
    }
  }
});
await test('concurrent dead-owner recovery cannot remove the new lock', async () => {
  const f = fixture();
  const module = JSON.stringify(
    new URL('./lifecycle-state.mjs', import.meta.url).href,
  );
  /** @type {import('node:child_process').ChildProcess[]} */
  const children = [];
  try {
    execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import {lock} from ${module};lock(${JSON.stringify(f.cwd)},'release');`,
    ]);
    const contenders = [0, 1].map(() => {
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {lock} from ${module};
process.send('ready');process.once('message',()=>{
try{const unlock=lock(process.argv[1],'release');process.send('acquired');process.once('message',()=>{unlock();process.disconnect();});}
catch{process.send('busy');process.disconnect();}});`,
          f.cwd,
        ],
        { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
      );
      children.push(child);
      const ready = new Promise((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
      });
      const result = new Promise((resolve, reject) => {
        child.on('message', (message) => {
          if (message !== 'ready') resolve(message);
        });
        child.once('error', reject);
      });
      const closed = new Promise((resolve) => child.once('exit', resolve));
      return { child, ready, result, closed };
    });
    await Promise.all(contenders.map((contender) => contender.ready));
    contenders.forEach(({ child }) => child.send('go'));
    assert.deepEqual(
      (await Promise.all(contenders.map(({ result }) => result))).sort((a, b) =>
        String(a).localeCompare(String(b)),
      ),
      ['acquired', 'busy'],
    );
    assert.throws(() => lock(f.cwd, 'release'), /lock exists/);
    contenders.forEach(({ child }) => {
      if (child.connected) child.send('release');
    });
    await Promise.all(contenders.map(({ closed }) => closed));
    lock(f.cwd, 'release')();
  } finally {
    children.forEach((child) => child.kill());
    f.cleanup();
  }
});
await test('a previous unlock never removes a replacement lock', () => {
  const f = fixture();
  try {
    const oldUnlock = lock(f.cwd, 'release');
    rmSync(join(f.cwd, '.git/lifecycle-release.lock'));
    const currentUnlock = lock(f.cwd, 'release');
    oldUnlock();
    assert.throws(() => lock(f.cwd, 'release'), /lock exists/);
    currentUnlock();
  } finally {
    f.cleanup();
  }
});
await test('final head checks require real completed review and resolved threads', () => {
  const head = 'a'.repeat(40);
  const status = {
    headRefOid: head,
    baseRefName: 'main',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: [{ conclusion: 'SUCCESS' }],
    reviews: [
      {
        user: { login: 'chatgpt-codex-connector[bot]' },
        commit_id: head,
        state: 'COMMENTED',
        body: "Didn't find any major issues.",
      },
    ],
    threads: [],
  };
  assert.equal(reviewGate(status, head), true);
  assert.throws(() => reviewGate(status, 'b'.repeat(40)), /head or base/);
  assert.throws(
    () => reviewGate({ ...status, reviews: [] }, head),
    /completed review/,
  );
  assert.throws(
    () => reviewGate({ ...status, statusCheckRollup: [] }, head),
    /checks/,
  );
  assert.throws(
    () => reviewGate({ ...status, threads: [{ isResolved: false }] }, head),
    /thread/,
  );
  assert.throws(
    () =>
      reviewGate(
        {
          ...status,
          reviews: [{ ...status.reviews[0], commit_id: 'b'.repeat(40) }],
        },
        head,
      ),
    /completed review/,
  );
  assert.equal(
    reviewGate(
      {
        ...status,
        reviews: [],
        actor: 'owner',
        comments: [
          {
            id: 1,
            user: { login: 'owner' },
            body: `@codex review\nLifecycle review head: ${head}`,
          },
          {
            id: 2,
            user: { login: 'chatgpt-codex-connector[bot]' },
            reviewedCommit: head,
            body: "Didn't find any major issues.",
          },
        ],
      },
      head,
    ),
    true,
  );
});
await test('version and notes derive from reviewed metadata including mixed and pre-stable changes', () => {
  assert.equal(nextVersion('0.3.4', ['patch', 'minor']), '0.4.0');
  assert.equal(nextVersion('0.3.4', ['major']), '0.4.0');
  assert.equal(nextVersion('1.3.4', ['major']), '2.0.0');
  assert.equal(nextVersion('0.3.4', ['none', 'patch']), '0.3.5');
  assert.throws(() => nextVersion('0.3.4', ['none']), /no release/);
  assert.throws(
    () => releaseChange('fix: guess the release'),
    /reviewed release metadata/,
  );
  const change = releaseChange(
    'Release-Type: patch\nRelease-Note: Save keeps the note.',
  );
  assert.deepEqual(change, { type: 'patch', note: 'Save keeps the note.' });
  const entry = releaseEntry(
    '# Changelog\n\n## 0.3.4 - 2026-01-01\n\nOld.\n',
    '0.3.5',
    [change],
    '2026-10-09',
  );
  assert.ok(entry.indexOf('## 0.3.5') < entry.indexOf('## 0.3.4'));
  assert.ok(entry.includes('### Fixed\n\n- Save keeps the note.'));
});
await test('release status reads saved uncertain state without retrying a write', async () => {
  const f = fixture();
  try {
    const state = {
      schemaVersion: 1,
      stage: 'tag-write',
      uncertain: true,
      version: '0.3.5',
    };
    save(join(stateDirectory(f.cwd), 'release.json'), state);
    assert.deepEqual(await release({ cwd: f.cwd, status: true }), state);
    await assert.rejects(
      release({ cwd: f.cwd, execute: true }),
      /unfinished release/,
    );
    assert.deepEqual(
      readState(join(stateDirectory(f.cwd), 'release.json')),
      state,
    );
  } finally {
    f.cleanup();
  }
});
await test('actual diff impact sees a storage semantic change and excludes an unrelated UI file', async () => {
  const f = fixture();
  try {
    git(f.cwd, ['switch', '-c', 'change']);
    mkdirSync(join(f.cwd, 'packages/storage-server/src'), { recursive: true });
    writeFileSync(
      join(f.cwd, 'packages/storage-server/src/accounts.ts'),
      'export {};\n',
    );
    git(f.cwd, ['add', '.']);
    git(f.cwd, ['commit', '-m', 'fix: controls']);
    const impact = await diffImpact(f.cwd, 'main');
    assert.equal(impact.operator, true);
    assert.equal(impact.ui, false);
    assert.deepEqual(impact.paths, ['packages/storage-server/src/accounts.ts']);
  } finally {
    f.cleanup();
  }
});
await test('public surface digest changes when migration SQL changes', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.cwd, 'packages/storage-server/migrations'), {
      recursive: true,
    });
    writeFileSync(
      join(f.cwd, 'packages/storage-server/migrations/0001.sql'),
      'original',
    );
    git(f.cwd, ['add', '.']);
    git(f.cwd, ['commit', '-m', 'feat: storage']);
    const before = await operatorDigests(f.cwd);
    writeFileSync(
      join(f.cwd, 'packages/storage-server/migrations/0001.sql'),
      'changed',
    );
    const after = await operatorDigests(f.cwd);
    assert.notEqual(before.surfaceDigest, after.surfaceDigest);
  } finally {
    f.cleanup();
  }
});
await test('manifest rejects image drift and missing migration or gate proof', () => {
  const sha = 'a'.repeat(40),
    hash = digest('fixture');
  const input = {
    schemaVersion: 1,
    repository: 'example/core',
    version: '0.3.5',
    tag: 'v0.3.5',
    source: { commit: sha, tree: sha },
    image: { reference: 'ghcr.io/example/core', digest: hash },
    operator: { contractDigest: hash, surfaceDigest: hash },
    migration: { requiredSchemaVersion: 1, digest: hash },
    verification: {
      commit: sha,
      inputDigest: hash,
      gates: ['verify', 'test:image'],
      runtime: process.version,
      toolDigest: hash,
    },
  };
  assert.equal(parseManifest(input).source.commit, sha);
  assert.throws(
    () =>
      parseManifest({
        ...input,
        image: { reference: input.image.reference, digest: 'latest' },
      }),
    /invalid/,
  );
  assert.throws(() => parseManifest({ ...input, migration: {} }), /invalid/);
  assert.throws(
    () =>
      parseManifest({
        ...input,
        verification: { ...input.verification, gates: ['verify'] },
      }),
    /invalid/,
  );
  assert.throws(
    () =>
      parseManifest({
        ...input,
        source: { ...input.source, commit: 'b'.repeat(40) },
      }),
    /invalid/,
  );
});
await test('preparation refuses internal work without its owner and paths outside the owned tree', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      prepare({
        cwd: f.cwd,
        task: 'task',
        paths: ['../outside'],
        phase: 'build',
      }),
      /stay in its repository/,
    );
    const previous = process.env.TIDYNOTEBOOK_CLOUD_DIR;
    delete process.env.TIDYNOTEBOOK_CLOUD_DIR;
    try {
      await assert.rejects(
        prepare({
          cwd: f.cwd,
          task: 'task',
          paths: ['source.txt'],
          phase: 'build',
          internal: true,
        }),
        /private repository/,
      );
    } finally {
      if (previous !== undefined) process.env.TIDYNOTEBOOK_CLOUD_DIR = previous;
    }
  } finally {
    f.cleanup();
  }
});
await test('release and lifecycle modules are importable without external writes', () => {
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(join(root, 'tools/release.mjs'))});`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result, '');
});

/** Builds a full release fixture with real signed tags and real remote Git. */
function releaseFixture() {
  const f = fixture(),
    cwd = f.cwd;
  for (const name of [
    'release-check.mjs',
    'release-notes.mjs',
    'workspace.mjs',
    'agent-context.mjs',
    'pr-screenshots.mjs',
  ])
    copyFileSync(join(root, 'tools', name), join(cwd, 'tools', name));
  mkdirSync(join(cwd, 'packages/core/src'), { recursive: true });
  copyFileSync(
    join(root, 'packages/core/src/product.ts'),
    join(cwd, 'packages/core/src/product.ts'),
  );
  mkdirSync(join(cwd, 'packages/storage-server/migrations/meta'), {
    recursive: true,
  });
  writeFileSync(
    join(cwd, 'packages/storage-server/src-placeholder'),
    'fixture',
  );
  mkdirSync(join(cwd, 'packages/storage-server/src'), { recursive: true });
  writeFileSync(
    join(cwd, 'packages/storage-server/src/migrate.ts'),
    'export const requiredSchemaVersion = 1;\n',
  );
  writeFileSync(
    join(cwd, 'packages/storage-server/migrations/0001.sql'),
    'fixture migration\n',
  );
  writeFileSync(
    join(cwd, 'packages/storage-server/migrations/meta/_journal.json'),
    JSON.stringify({ entries: [{ idx: 0 }] }),
  );
  mkdirSync(join(cwd, '.github/workflows'), { recursive: true });
  writeFileSync(
    join(cwd, '.github/workflows/release.yml'),
    'env:\n  IMAGE: ghcr.io/example/core\n',
  );
  mkdirSync(join(cwd, 'tools/sdk-codegen/node_modules/.bin'), {
    recursive: true,
  });
  writeFileSync(
    join(cwd, 'tools/sdk-codegen/node_modules/.bin/redocly'),
    `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
writeFileSync(process.argv.at(-1),JSON.stringify({openapi:'3.1.0',info:{title:'Fixture',version:'1'},paths:{'/api/operator/accounts':{get:{tags:['operator'],operationId:'findAccounts',responses:{200:{description:'Found'}}}},'/api/other':{get:{operationId:'other'}}},components:{securitySchemes:{operatorToken:{type:'http',scheme:'bearer'}}}}));
`,
    { mode: 0o700 },
  );
  writeFileSync(join(cwd, '.gitignore'), '.tooling/\n**/node_modules/\n');
  writeFileSync(
    join(cwd, 'README.md'),
    '# Fixture\n\n**Status:** 0.1.0 is the current release. See\n',
  );
  writeFileSync(
    join(cwd, 'CHANGELOG.md'),
    '# Changelog\n\n## 0.1.0 - 2026-01-01\n\nOld release.\n\n### Added\n\n- A note.\n',
  );
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', 'chore: initial release']);
  git(cwd, ['tag', 'v0.1.0']);
  writeFileSync(join(cwd, 'source.txt'), 'feature');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', 'feat: new feature']);
  const remote = join(cwd, '.tooling/remote');
  execFileSync('/usr/bin/git', ['init', '--bare', remote], { stdio: 'ignore' });
  git(cwd, [
    'config',
    `url.${remote}.insteadOf`,
    'https://github.com/example/core',
  ]);
  git(cwd, ['push', 'origin', 'main', '--tags']);
  const key = join(cwd, '.tooling/key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  writeFileSync(
    join(cwd, '.tooling/signers'),
    'test@example.com ' + readFileSync(key + '.pub', 'utf8'),
  );
  git(cwd, ['config', 'gpg.format', 'ssh']);
  git(cwd, [
    'config',
    'gpg.ssh.allowedSignersFile',
    join(cwd, '.tooling/signers'),
  ]);
  git(cwd, ['config', 'user.signingkey', key]);
  git(cwd, ['config', 'tag.gpgsign', 'true']);
  save(join(cwd, '.tooling/service.json'), {
    cleanReview: true,
    comments: [],
    writes: [],
    assets: [],
  });
  writeFileSync(
    join(cwd, '.tooling/bin/gh'),
    `#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const a=process.argv.slice(2),s=JSON.parse(readFileSync('.tooling/service.json','utf8'));
const git=(...args)=>execFileSync('/usr/bin/git',args,{encoding:'utf8'}).trim();
const head=git('rev-parse','HEAD');let version='0.2.0';try{version=JSON.parse(readFileSync('.tooling/lifecycle/release.json','utf8')).version;}catch{}
const store=()=>writeFileSync('.tooling/service.json',JSON.stringify(s));
const json=v=>console.log(JSON.stringify(v));
const write=kind=>{s.writes.push(kind);store();if(s.interrupt===kind){s.interrupt=null;store();process.exit(7);}};
const pr=()=>{const prepared=s.prepared??head;let merged=false;try{merged=git('--git-dir=.tooling/remote','rev-parse','main')===prepared;}catch{};return{number:s.prNumber??41,url:'https://github.com/example/core/pull/41',headRefOid:prepared,baseRefName:'main',state:merged?'MERGED':'OPEN',isDraft:false,mergeable:'MERGEABLE',mergeStateStatus:'CLEAN',statusCheckRollup:[{conclusion:'SUCCESS'}],reviews:[],reviewDecision:'',mergeCommit:{oid:s.mergedCommit??prepared}};};
if(a[0]==='attestation'&&a.includes('--help')){if(s.unsupportedAttestation)process.exit(1);console.log(s.missingSourceFlag?'--repo --signer-workflow --source-ref':'--repo --signer-workflow --source-digest --source-ref');}
else if(a[0]==='pr'&&a[1]==='list')json(s.created?[{number:41}]:[]);
else if(a[0]==='pr'&&a[1]==='create'){s.created=true;s.prepared=head;write('pr-create');console.log(pr().url);}
else if(a[0]==='pr'&&a[1]==='edit'){}
else if(a[0]==='pr'&&a[1]==='view')json(pr());
else if(a[0]==='pr'&&a[1]==='comment'){s.comments.push({id:s.comments.length+1,user:{login:'owner'},body:a.at(-1)});write('review-request');}
else if(a[0]==='run'){if(a.includes('--jq'))console.log('completed\\tsuccess\\thttps://github.com/example/core/actions/runs/1\\t'+s.prepared);else json([{databaseId:1,headSha:s.prepared,status:'completed',conclusion:'success'}]);}
else if(a[0]==='attestation'){if(s.badProvenance||(s.provenanceSource&&a.includes('--source-digest')&&a[a.indexOf('--source-digest')+1]!==s.provenanceSource)||(s.provenanceRef&&a.includes('--source-ref')&&a[a.indexOf('--source-ref')+1]!==s.provenanceRef))process.exit(1);console.log('{}');}
else if(a[0]==='release'&&a[1]==='create'){s.release=true;s.releaseName=a[a.indexOf('--title')+1];s.notes=readFileSync(a[a.indexOf('--notes-file')+1],'utf8');s.assets=[{name:'release-manifest.json',id:1,url:'https://api.github.com/repos/example/core/releases/assets/1',bytes:readFileSync(a.at(-2),'utf8')}];write('release-create');if(s.partialCreate)process.exit(0);s.assets.push({name:'operator-contract.json',id:2,url:'https://api.github.com/repos/example/core/releases/assets/2',bytes:readFileSync(a.at(-1),'utf8')});store();}
else if(a[0]==='release'&&a[1]==='upload'){const name=a.at(-1).split('/').at(-1);const id=name==='release-manifest.json'?1:2;s.assets.push({name,id,url:'https://api.github.com/repos/example/core/releases/assets/'+id,bytes:readFileSync(a.at(-1),'utf8')});write('asset-upload');}
else if(a[0]==='release'&&a[1]==='view'){const fields=a[a.indexOf('--json')+1];if(fields==='body')process.stdout.write(s.notes);else console.log(s.releaseName+'\\tv'+version+'\\tfalse\\tfalse');}
else if(a[0]==='api'&&a[1]==='graphql')json({data:{repository:{pullRequest:{reviewThreads:{nodes:s.unresolved?[{isResolved:false}]:[],pageInfo:{hasNextPage:false}}}}}});
else if(a[0]==='api'&&a[1]==='user')console.log('owner');
else if(a[0]==='api'&&a[1].startsWith('https://api.github.com/repos/example/core/releases/assets/')){const asset=s.assets.find(v=>v.url===a[1]);if(!asset)process.exit(1);process.stdout.write(asset.bytes);}
else if(a[0]==='api'&&a[1].includes('/commits/'))json([{number:40,merged_at:'2026-10-09',base:{ref:'main'},body:'Release-Type: minor\\nRelease-Note: Read a new note.'}]);
else if(a[0]==='api'&&a[1].includes('/reviews'))json(s.cleanReview?[{user:{login:'chatgpt-codex-connector[bot]'},commit_id:s.prepared,state:'COMMENTED',body:"Didn't find any major issues."}]:[]);
else if(a[0]==='api'&&a[1].includes('/comments'))json(s.comments);
else if(a[0]==='api'&&a[1].startsWith('users/'))console.log('Organization');
else if(a[0]==='api'&&a[1].includes('/packages/'))console.log(version);
else if(a[0]==='api'&&a[1].includes('/releases/tags/')){if(s.releaseReadFailure){console.error('gh: Bad Gateway (HTTP 502)');process.exit(1);}if(!s.release){console.error('gh: Not Found (HTTP 404)');process.exit(1);}json({name:s.releaseName,tag_name:'v'+version,body:s.notes,draft:false,prerelease:false,assets:s.assets});}
else if(a[0]==='api'&&a[1].includes('/releases?'))json(s.release?[{name:s.releaseName,tag_name:'v'+version,body:s.notes,draft:false,prerelease:false,assets:s.assets}]:[]);
else if(a[0]==='api'&&a[1].includes('/releases/latest'))console.log('v'+version);
else if(a[0]==='api'&&a.includes('POST')){s.milestone=true;write('milestone-create');json({number:1,state:'closed'});}
else if(a[0]==='api'&&a.includes('PATCH')){s.milestone=true;write('milestone-close');json({number:1,state:'closed'});}
else if(a[0]==='api'&&a[1].includes('/milestones')){if(a.includes('--jq'))console.log(s.milestone?'closed\\t0':'');else json(s.milestone?[{number:1,title:version,state:'closed',open_issues:0}]:[]);}
else {console.error('Unhandled gh '+JSON.stringify(a));process.exit(2);}
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(cwd, '.tooling/bin/docker'),
    `#!/usr/bin/env node
import {readFileSync,appendFileSync,existsSync} from 'node:fs';
const a=process.argv.slice(2),s=JSON.parse(readFileSync('.tooling/service.json','utf8'));
if(a[0]==='build'){if(!existsSync(a.at(-1)+'/source.txt'))process.exit(1);appendFileSync('.tooling/builds','build\\n');}
else if(a[0]==='pull'){}
else if(a.includes('{{.Id}}'))console.log('sha256:'+'b'.repeat(64));
else if(a.includes('{{index .RepoDigests 0}}'))console.log('ghcr.io/example/core@sha256:'+(s.imageDigest??'c'.repeat(64)));
else if(a.some(v=>v.includes('org.opencontainers.image.revision')))console.log(s.prepared);
else if(a[0]==='image')console.log(JSON.stringify([{RepoDigests:['ghcr.io/example/core@sha256:'+(s.imageDigest??'c'.repeat(64))],Config:{Labels:{'org.opencontainers.image.revision':s.prepared}}}]));
else console.log('fixture-runtime');
`,
    { mode: 0o700 },
  );
  return f;
}

await test('the complete release runs once, signs its tag, publishes exact assets, and closes its milestone', async () => {
  const f = releaseFixture();
  try {
    const result = await release({ cwd: f.cwd, execute: true });
    assert.equal(result.stage, 'complete');
    assert.equal(result.version, '0.2.0');
    const service = readState(join(f.cwd, '.tooling/service.json'));
    assert.equal(service.milestone, true);
    assert.deepEqual(service.writes, [
      'pr-create',
      'review-request',
      'release-create',
      'milestone-create',
    ]);
    assert.doesNotThrow(() => git(f.cwd, ['verify-tag', 'v0.2.0']));
    assert.equal(
      git(f.cwd, ['rev-parse', 'v0.2.0^{commit}']),
      result.releaseCommit,
    );
    const manifestFile = result.manifestFile;
    assert.equal(typeof manifestFile, 'string');
    if (typeof manifestFile !== 'string')
      throw new Error('Missing manifest file.');
    const manifest = parseManifest(
      JSON.parse(readFileSync(manifestFile, 'utf8')),
    );
    assert.equal(manifest.source.commit, result.releaseCommit);
    const again = await release({ cwd: f.cwd, resume: true, execute: true });
    assert.equal(again.stage, 'complete');
    assert.deepEqual(
      readState(join(f.cwd, '.tooling/service.json')).writes,
      service.writes,
    );
  } finally {
    f.cleanup();
  }
});
await test('an uncertain release create resumes by reading and adding only the missing exact asset', async () => {
  const f = releaseFixture();
  try {
    const file = join(f.cwd, '.tooling/service.json');
    save(file, { ...readState(file), interrupt: 'release-create' });
    await assert.rejects(release({ cwd: f.cwd, execute: true }));
    assert.equal(
      readState(join(stateDirectory(f.cwd), 'release.json')).stage,
      'publish',
    );
    const result = await release({ cwd: f.cwd, resume: true, execute: true });
    assert.equal(result.stage, 'complete');
    const writes = readState(file).writes;
    assert.ok(Array.isArray(writes));
    assert.equal(
      Array.isArray(writes)
        ? writes.filter((value) => value === 'release-create').length
        : 0,
      1,
    );
    assert.ok(Array.isArray(writes) && writes.includes('asset-upload'));
  } finally {
    f.cleanup();
  }
});
await test('an interrupted prepare PR creation reads the existing PR and does not create another', async () => {
  const f = releaseFixture();
  try {
    const file = join(f.cwd, '.tooling/service.json');
    save(file, { ...readState(file), interrupt: 'pr-create' });
    await assert.rejects(release({ cwd: f.cwd, execute: true }));
    assert.equal(
      readState(join(stateDirectory(f.cwd), 'release.json')).stage,
      'prepared',
    );
    const result = await release({ cwd: f.cwd, resume: true, execute: true });
    assert.equal(result.stage, 'complete');
    const writes = readState(file).writes;
    assert.equal(
      Array.isArray(writes)
        ? writes.filter((value) => value === 'pr-create').length
        : 0,
      1,
    );
  } finally {
    f.cleanup();
  }
});
await test('pending review saves its phase and resumes only after the same head receives review', async () => {
  const f = releaseFixture();
  try {
    const file = join(f.cwd, '.tooling/service.json');
    save(file, { ...readState(file), cleanReview: false });
    await assert.rejects(
      release({ cwd: f.cwd, execute: true }),
      /completed review/,
    );
    const before = readState(join(stateDirectory(f.cwd), 'release.json'));
    assert.equal(before.stage, 'review');
    assert.equal(git(f.cwd, ['tag', '--list', 'v0.2.0']), '');
    save(file, { ...readState(file), cleanReview: true });
    const result = await release({ cwd: f.cwd, resume: true, execute: true });
    assert.equal(result.stage, 'complete');
    assert.equal(result.prepareCommit, before.prepareCommit);
  } finally {
    f.cleanup();
  }
});

await test('a delayed prior-head clean comment and mixed clean text never permit landing', () => {
  const head = 'a'.repeat(40);
  const status = {
    headRefOid: head,
    baseRefName: 'main',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: [{ conclusion: 'SUCCESS' }],
    reviews: [],
    threads: [],
    actor: 'owner',
    comments: [
      {
        id: 3,
        user: { login: 'owner' },
        body: `Lifecycle review head: ${head}`,
      },
      {
        id: 4,
        user: { login: 'chatgpt-codex-connector[bot]' },
        reviewedCommit: 'b'.repeat(40),
        body: "Didn't find any major issues.",
      },
    ],
  };
  assert.throws(() => reviewGate(status, head), /completed review/);
  assert.equal(
    cleanReviewBody('Did not find any input issues, but found data loss.'),
    false,
  );
  assert.equal(
    cleanReviewBody("Didn't find any major issues.\nP2: stale data"),
    false,
  );
  assert.equal(
    cleanReviewBody(
      "Codex Review: Didn't find any major issues. Keep them coming!\n\n**Reviewed commit:** `fbb04b9de3`",
    ),
    true,
  );
});

/** Stops after a successful Git write to model a lost process result. @param {string} cwd @param {string} kind */
function interruptGit(cwd, kind) {
  const state = join(cwd, '.tooling/service.json');
  save(state, { ...readState(state), gitInterrupt: kind });
  writeFileSync(
    join(cwd, '.tooling/bin/git'),
    `#!/usr/bin/env node
import {spawnSync} from 'node:child_process';import{readFileSync,writeFileSync}from'node:fs';
const a=process.argv.slice(2),r=spawnSync('/usr/bin/git',a,{stdio:'inherit'});
let s;try{s=JSON.parse(readFileSync('.tooling/service.json','utf8'));}catch{}
const kind=a[0]==='push'&&a.some(v=>v.startsWith('refs/tags/'))?'push-tag':a[0];
if(r.status===0&&s&&s.gitInterrupt===kind){s.gitInterrupt=null;s.gitInterrupted=kind;writeFileSync('.tooling/service.json',JSON.stringify(s));process.exit(7);}process.exit(r.status??1);
`,
    { mode: 0o700 },
  );
}
await test('prepare resumes after each successful local write without a second prepare commit', async () => {
  for (const kind of ['switch', 'add', 'commit']) {
    const f = releaseFixture();
    try {
      interruptGit(f.cwd, kind);
      await assert.rejects(release({ cwd: f.cwd, execute: true }));
      const interrupted = readState(
        join(stateDirectory(f.cwd), 'release.json'),
      );
      assert.equal(interrupted.stage, 'planned');
      assert.equal(
        readState(join(f.cwd, '.tooling/service.json')).gitInterrupted,
        kind,
      );
      const result = await release({ cwd: f.cwd, resume: true, execute: true });
      assert.equal(result.stage, 'complete');
      assert.equal(
        git(f.cwd, ['log', '--all', '--format=%s'])
          .split('\n')
          .filter((subject) => subject === 'chore(release): prepare 0.2.0')
          .length,
        1,
      );
    } finally {
      f.cleanup();
    }
  }
});
await test('a lost tag push result resumes from the remote fixed tag without another push', async () => {
  const f = releaseFixture();
  try {
    interruptGit(f.cwd, 'push-tag');
    await assert.rejects(release({ cwd: f.cwd, execute: true }));
    const before = readState(join(stateDirectory(f.cwd), 'release.json'));
    assert.equal(before.stage, 'tag-write');
    assert.equal(before.uncertain, true);
    const tagObject = git(f.cwd, ['rev-parse', 'v0.2.0']);
    const result = await release({ cwd: f.cwd, resume: true, execute: true });
    assert.equal(result.stage, 'complete');
    assert.equal(git(f.cwd, ['rev-parse', 'v0.2.0']), tagObject);
  } finally {
    f.cleanup();
  }
});
await test('a changed prepared source or origin cannot resume a release', async () => {
  const f = releaseFixture();
  try {
    const file = join(f.cwd, '.tooling/service.json');
    save(file, { ...readState(file), cleanReview: false });
    await assert.rejects(
      release({ cwd: f.cwd, execute: true }),
      /completed review/,
    );
    git(f.cwd, [
      'remote',
      'set-url',
      'origin',
      'https://github.com/example/other',
    ]);
    await assert.rejects(
      release({ cwd: f.cwd, resume: true, execute: true }),
      /identity changes/,
    );
    git(f.cwd, [
      'remote',
      'set-url',
      'origin',
      'https://github.com/example/core',
    ]);
    writeFileSync(join(f.cwd, 'source.txt'), 'changed source');
    git(f.cwd, ['add', '.']);
    git(f.cwd, ['commit', '-m', 'fix: change source']);
    await assert.rejects(
      release({ cwd: f.cwd, resume: true, execute: true }),
      /prepare source changes/,
    );
  } finally {
    f.cleanup();
  }
});

await test('migration metadata binds SQL and journal bytes and refuses a count drift', () => {
  const f = releaseFixture();
  try {
    const before = migrationMetadata(f.cwd);
    const sql = join(f.cwd, 'packages/storage-server/migrations/0001.sql');
    writeFileSync(sql, 'different migration');
    assert.notEqual(migrationMetadata(f.cwd).digest, before.digest);
    const journal = join(
      f.cwd,
      'packages/storage-server/migrations/meta/_journal.json',
    );
    writeFileSync(
      journal,
      JSON.stringify({ entries: [{ idx: 0, tag: 'different' }] }),
    );
    assert.notEqual(migrationMetadata(f.cwd).digest, before.digest);
    writeFileSync(journal, JSON.stringify({ entries: [] }));
    assert.throws(() => migrationMetadata(f.cwd), /journal differ/);
  } finally {
    f.cleanup();
  }
});

await test('a zero-exit partial release upload stays at publish until both exact assets are read back', async () => {
  const f = releaseFixture();
  try {
    const file = join(f.cwd, '.tooling/service.json');
    save(file, { ...readState(file), partialCreate: true });
    await assert.rejects(
      release({ cwd: f.cwd, execute: true }),
      /asset|publication/,
    );
    assert.equal(
      readState(join(stateDirectory(f.cwd), 'release.json')).stage,
      'publish',
    );
    assert.equal(readState(file).milestone, undefined);
    const result = await release({ cwd: f.cwd, resume: true, execute: true });
    assert.equal(result.stage, 'complete');
    assert.deepEqual(readState(file).writes, [
      'pr-create',
      'review-request',
      'release-create',
      'asset-upload',
      'milestone-create',
    ]);
  } finally {
    f.cleanup();
  }
});

await test('the after gate refuses missing or changed assets and a new image digest with the same source label', async () => {
  const f = releaseFixture();
  try {
    await release({ cwd: f.cwd, execute: true });
    const file = join(f.cwd, '.tooling/service.json'),
      initial = readState(file);
    const assets = Array.isArray(initial.assets) ? initial.assets : [];
    save(file, {
      ...initial,
      assets: assets.filter((asset) => asset.name !== 'operator-contract.json'),
    });
    assert.equal(await releaseCheck('after', '0.2.0', f.cwd), 1);
    for (const name of ['operator-contract.json', 'release-manifest.json']) {
      save(file, {
        ...initial,
        assets: assets.map((asset) =>
          asset.name === name
            ? { ...asset, bytes: asset.bytes + 'changed' }
            : asset,
        ),
      });
      assert.equal(await releaseCheck('after', '0.2.0', f.cwd), 1);
    }
    save(file, { ...initial, imageDigest: 'd'.repeat(64) });
    assert.equal(await releaseCheck('after', '0.2.0', f.cwd), 1);
  } finally {
    f.cleanup();
  }
});

await test('resume refuses a differing release asset before the milestone write', async () => {
  const f = releaseFixture();
  try {
    const file = join(f.cwd, '.tooling/service.json');
    save(file, { ...readState(file), interrupt: 'release-create' });
    await assert.rejects(release({ cwd: f.cwd, execute: true }));
    const service = readState(file),
      assets = Array.isArray(service.assets) ? service.assets : [];
    save(file, {
      ...service,
      assets: assets.map((asset) => ({ ...asset, bytes: 'different' })),
    });
    await assert.rejects(
      release({ cwd: f.cwd, resume: true, execute: true }),
      /asset differs/,
    );
    assert.equal(readState(file).milestone, undefined);
  } finally {
    f.cleanup();
  }
});

await test('same repository and workflow provenance must hold the fixed source and tag ref', async () => {
  for (const mismatch of [
    { provenanceSource: 'f'.repeat(40) },
    { provenanceRef: 'refs/heads/main' },
  ]) {
    const f = releaseFixture();
    try {
      const file = join(f.cwd, '.tooling/service.json');
      save(file, { ...readState(file), ...mismatch });
      await assert.rejects(release({ cwd: f.cwd, execute: true }));
      assert.equal(
        readState(join(stateDirectory(f.cwd), 'release.json')).stage,
        'image',
      );
      assert.equal(readState(file).release, undefined);
    } finally {
      f.cleanup();
    }
  }
});

await test('missing attestation command or source policy stops before prepare writes', async () => {
  for (const capability of [
    { unsupportedAttestation: true },
    { missingSourceFlag: true },
  ]) {
    const f = releaseFixture();
    try {
      const head = git(f.cwd, ['rev-parse', 'HEAD']),
        file = join(f.cwd, '.tooling/service.json');
      save(file, { ...readState(file), ...capability });
      await assert.rejects(
        release({ cwd: f.cwd, execute: true }),
        /attestation/,
      );
      assert.equal(git(f.cwd, ['rev-parse', 'HEAD']), head);
      assert.deepEqual(readState(file).writes, []);
      assert.equal(git(f.cwd, ['tag', '--list', 'v0.2.0']), '');
    } finally {
      f.cleanup();
    }
  }
});

await test('an external merge cannot bypass review or accept a different prepare commit', async () => {
  for (const mode of ['review', 'threads', 'commit']) {
    const f = releaseFixture();
    try {
      const file = join(f.cwd, '.tooling/service.json');
      save(file, { ...readState(file), cleanReview: false });
      await assert.rejects(
        release({ cwd: f.cwd, execute: true }),
        /completed review/,
      );
      const head = git(f.cwd, ['rev-parse', 'HEAD']);
      git(f.cwd, ['push', 'origin', head + ':refs/heads/main']);
      save(file, {
        ...readState(file),
        cleanReview: mode !== 'review',
        unresolved: mode === 'threads',
        ...(mode === 'commit'
          ? { mergedCommit: git(f.cwd, ['rev-parse', 'HEAD^']) }
          : {}),
      });
      await assert.rejects(
        release({ cwd: f.cwd, resume: true, execute: true }),
        /review|thread|merged.*differs|merge.*attempt/,
      );
      assert.equal(git(f.cwd, ['tag', '--list', 'v0.2.0']), '');
    } finally {
      f.cleanup();
    }
  }
});

await test('a lost exact main push result resumes with its recorded validated attempt', async () => {
  const f = releaseFixture();
  try {
    interruptGit(f.cwd, 'push');
    // The branch push precedes the main push. Begin with the review wait first.
    const file = join(f.cwd, '.tooling/service.json');
    save(file, { ...readState(file), gitInterrupt: null, cleanReview: false });
    await assert.rejects(
      release({ cwd: f.cwd, execute: true }),
      /completed review/,
    );
    save(file, { ...readState(file), cleanReview: true, gitInterrupt: 'push' });
    await assert.rejects(release({ cwd: f.cwd, resume: true, execute: true }));
    const before = readState(join(stateDirectory(f.cwd), 'land.json'));
    assert.equal(before.stage, 'merge-write');
    assert.equal(land(f.cwd, '41', false).stage, 'ready');
    assert.deepEqual(
      readState(join(stateDirectory(f.cwd), 'land.json')),
      before,
    );
    save(file, { ...readState(file), cleanReview: false });
    const result = await release({ cwd: f.cwd, resume: true, execute: true });
    assert.equal(result.stage, 'complete');
    assert.equal(result.releaseCommit, before.commit);
    const landed = readState(join(stateDirectory(f.cwd), 'land.json'));
    assert.equal(land(f.cwd, '41', false).stage, 'ready');
    assert.deepEqual(
      readState(join(stateDirectory(f.cwd), 'land.json')),
      landed,
    );
    assert.equal(land(f.cwd, '41', true).stage, 'landed');
  } finally {
    f.cleanup();
  }
});

await test('published page review requires both light and dark evidence', async () => {
  const f = releaseFixture();
  try {
    git(f.cwd, ['fetch', 'origin', 'main']);
    git(f.cwd, ['switch', '-c', 'page']);
    mkdirSync(join(f.cwd, 'apps/server/src/routes'), { recursive: true });
    writeFileSync(
      join(f.cwd, 'apps/server/src/routes/published-document.ts'),
      'export {};',
    );
    git(f.cwd, ['add', '.']);
    git(f.cwd, ['commit', '-m', 'fix: page']);
    assert.equal((await diffImpact(f.cwd, 'origin/main')).ui, true);
    prove(f.cwd);
    const options = {
      title: 'fix: page',
      summary: 'Read the page.',
      compatibility: 'No operator change.',
      releaseType: 'patch',
      releaseNote: 'Read the page.',
      execute: false,
    };
    await assert.rejects(
      prepareReview(f.cwd, { ...options, screenshots: [] }),
      /light and dark/,
    );
    await assert.rejects(
      prepareReview(f.cwd, { ...options, screenshots: ['page-light.png'] }),
      /light and dark/,
    );
    assert.equal(
      (
        await prepareReview(f.cwd, {
          ...options,
          screenshots: ['page-light.png', 'page-dark.png'],
        })
      ).impact.ui,
      true,
    );
  } finally {
    f.cleanup();
  }
});

await test('lifecycle parsing rejects unknown flags and wrong arity before a write', () => {
  for (const args of [
    ['prove', '--execute'],
    ['prove', 'extra'],
    ['land', '41', '--typo'],
    ['land'],
    ['land', '41', '42'],
    ['review-status', '--execute'],
    ['status', 'extra'],
    ['review', '--release-type', 'patch', '--title-file'],
  ])
    assert.throws(() => parseLifecycle(args, root));
  assert.equal(parseLifecycle(['land', '41', '--execute'], root).pr, '41');
  assert.equal(parseLifecycle(['prove', '--image'], root).image, true);
});

await test('internal task routing preserves the requested phase and core paths', async () => {
  const f = fixture();
  try {
    const owner = join(f.cwd, '.tooling/cloud');
    mkdirSync(join(owner, 'tools'), { recursive: true });
    writeFileSync(
      join(owner, 'tools/task-prepare.mjs'),
      `console.log(JSON.stringify({args:process.argv.slice(2)}));`,
    );
    const result = await prepare({
      cwd: f.cwd,
      task: 'internal-task',
      phase: 'review',
      paths: ['source.txt', 'tools/lifecycle.mjs'],
      internal: true,
      cloudRoot: owner,
    });
    assert.deepEqual(result.args, [
      '--cloud-root',
      owner,
      '--core-root',
      f.cwd,
      '--internal',
      '--task',
      'internal-task',
      '--phase',
      'review',
      '--core-path',
      'source.txt',
      '--core-path',
      'tools/lifecycle.mjs',
    ]);
  } finally {
    f.cleanup();
  }
});

await test('release recovery does not treat a failed exact-target read as absence', async () => {
  const f = releaseFixture();
  try {
    const file = join(f.cwd, '.tooling/service.json');
    save(file, { ...readState(file), releaseReadFailure: true });
    await assert.rejects(release({ cwd: f.cwd, execute: true }));
    const writes = readState(file).writes;
    assert.ok(Array.isArray(writes) && !writes.includes('release-create'));
    assert.equal(
      readState(join(stateDirectory(f.cwd), 'release.json')).stage,
      'publish',
    );
  } finally {
    f.cleanup();
  }
});

await test('a saved prepare resumes on a later day without a new commit', async () => {
  const f = releaseFixture();
  try {
    const file = join(f.cwd, '.tooling/service.json'),
      stateFile = join(stateDirectory(f.cwd), 'release.json');
    const planned = await release({ cwd: f.cwd, execute: false });
    save(stateFile, { ...planned, date: '2026-01-02' });
    save(file, { ...readState(file), cleanReview: false });
    await assert.rejects(
      release({ cwd: f.cwd, resume: true, execute: true }),
      /completed review/,
    );
    const prepared = readState(stateFile).prepareCommit;
    assert.ok(
      readFileSync(join(f.cwd, 'CHANGELOG.md'), 'utf8').includes(
        '0.2.0 - 2026-01-02',
      ),
    );
    save(file, { ...readState(file), cleanReview: true });
    const result = await release({ cwd: f.cwd, resume: true, execute: true });
    assert.equal(result.stage, 'complete');
    assert.equal(result.prepareCommit, prepared);
  } finally {
    f.cleanup();
  }
});

await test('a recorded exact main push cannot recover with an external merge commit', async () => {
  const f = releaseFixture();
  try {
    const file = join(f.cwd, '.tooling/service.json');
    save(file, { ...readState(file), cleanReview: false });
    await assert.rejects(
      release({ cwd: f.cwd, execute: true }),
      /completed review/,
    );
    interruptGit(f.cwd, 'push');
    save(file, { ...readState(file), cleanReview: true });
    await assert.rejects(release({ cwd: f.cwd, resume: true, execute: true }));
    save(file, {
      ...readState(file),
      mergedCommit: git(f.cwd, ['rev-parse', 'HEAD^']),
    });
    await assert.rejects(
      release({ cwd: f.cwd, resume: true, execute: true }),
      /merge result.*differs/,
    );
    assert.equal(git(f.cwd, ['tag', '--list', 'v0.2.0']), '');
  } finally {
    f.cleanup();
  }
});

await test('the historical after gate accepts a fresh checkout and a new runtime receipt', async () => {
  const f = releaseFixture();
  try {
    await release({ cwd: f.cwd, execute: true });
    const proofFile = join(stateDirectory(f.cwd), 'proof.json'),
      releaseFile = join(stateDirectory(f.cwd), 'release.json');
    const proof = readState(proofFile),
      saved = readState(releaseFile);
    save(proofFile, {
      ...proof,
      runtime: 'v99.1.1',
      inputDigest: digest('a new local environment'),
    });
    assert.equal(await releaseCheck('after', '0.2.0', f.cwd), 0);
    rmSync(proofFile);
    rmSync(releaseFile);
    const fresh = join(f.cwd, '.tooling/fresh-checkout');
    git(f.cwd, [
      'clone',
      '--branch',
      'main',
      join(f.cwd, '.tooling/remote'),
      fresh,
    ]);
    git(fresh, [
      'remote',
      'set-url',
      'origin',
      'https://github.com/example/core',
    ]);
    git(fresh, [
      'config',
      `url.${join(f.cwd, '.tooling/remote')}.insteadOf`,
      'https://github.com/example/core',
    ]);
    git(fresh, ['config', 'gpg.format', 'ssh']);
    git(fresh, [
      'config',
      'gpg.ssh.allowedSignersFile',
      join(f.cwd, '.tooling/signers'),
    ]);
    mkdirSync(join(fresh, '.tooling/bin'), { recursive: true });
    mkdirSync(join(fresh, 'tools/sdk-codegen/node_modules/.bin'), {
      recursive: true,
    });
    copyFileSync(
      join(f.cwd, '.tooling/service.json'),
      join(fresh, '.tooling/service.json'),
    );
    for (const name of ['gh', 'docker'])
      copyFileSync(
        join(f.cwd, '.tooling/bin', name),
        join(fresh, '.tooling/bin', name),
      );
    copyFileSync(
      join(f.cwd, 'tools/sdk-codegen/node_modules/.bin/redocly'),
      join(fresh, 'tools/sdk-codegen/node_modules/.bin/redocly'),
    );
    assert.deepEqual(readState(join(stateDirectory(fresh), 'proof.json')), {});
    assert.equal(await releaseCheck('after', '0.2.0', fresh), 0);
    // A later HEAD does not change the tagged source or contract.
    writeFileSync(
      join(f.cwd, 'packages/storage-server/migrations/0001.sql'),
      'later source',
    );
    git(f.cwd, ['add', '.']);
    git(f.cwd, ['commit', '-m', 'feat: later main source']);
    assert.equal(await releaseCheck('after', '0.2.0', f.cwd), 0);
    // Original publication bytes remain fixed when the saved intent is available.
    save(releaseFile, saved);
    const serviceFile = join(f.cwd, '.tooling/service.json'),
      service = readState(serviceFile);
    const assets = Array.isArray(service.assets) ? service.assets : [];
    save(serviceFile, {
      ...service,
      assets: assets.map((value) => {
        const asset = record(value);
        if (asset.name !== 'release-manifest.json') return asset;
        assert.equal(typeof asset.bytes, 'string');
        if (typeof asset.bytes !== 'string')
          throw new Error('The fixture asset bytes are missing.');
        const manifest = record(JSON.parse(asset.bytes));
        return {
          ...asset,
          bytes:
            JSON.stringify(
              {
                ...manifest,
                verification: {
                  ...record(manifest.verification),
                  runtime: 'v99.1.1',
                },
              },
              null,
              2,
            ) + '\n',
        };
      }),
    });
    assert.equal(await releaseCheck('after', '0.2.0', f.cwd), 1);
  } finally {
    f.cleanup();
  }
});

await test('private task context rejects a non-object response', async () => {
  const f = fixture();
  try {
    const owner = join(f.cwd, '.tooling/cloud');
    mkdirSync(join(owner, 'tools'), { recursive: true });
    writeFileSync(
      join(owner, 'tools/task-prepare.mjs'),
      'console.log("null");',
    );
    await assert.rejects(
      prepare({
        cwd: f.cwd,
        task: 'internal-task',
        phase: 'review',
        paths: [],
        internal: true,
        cloudRoot: owner,
      }),
      /private task context is invalid/,
    );
  } finally {
    f.cleanup();
  }
});

await test('remote PR and release asset identities require positive numeric IDs', async () => {
  const f = releaseFixture();
  try {
    const file = join(f.cwd, '.tooling/service.json');
    save(file, { ...readState(file), prNumber: '41' });
    assert.throws(() => readPull(f.cwd, '41'), /PR number is invalid/);
    save(file, { ...readState(file), prNumber: 41 });
    await release({ cwd: f.cwd, execute: true });
    const service = readState(file);
    const assets = Array.isArray(service.assets)
      ? service.assets.map(record)
      : [];
    save(file, {
      ...service,
      assets: assets.map((asset) =>
        asset.name === 'operator-contract.json'
          ? {
              ...asset,
              id: -1,
              url: 'https://api.github.com/repos/example/core/releases/assets/-1',
            }
          : asset,
      ),
    });
    assert.throws(
      () => publishedRelease(f.cwd, 'v0.2.0'),
      /asset identity is invalid/,
    );
  } finally {
    f.cleanup();
  }
});

await test('saved release notes reject a non-string before prepare writes', async () => {
  const f = releaseFixture();
  try {
    const plan = await release({ cwd: f.cwd });
    save(join(stateDirectory(f.cwd), 'release.json'), {
      ...plan,
      changes: [{ type: 'minor', note: {} }],
    });
    const before = git(f.cwd, ['rev-parse', 'HEAD']);
    await assert.rejects(
      release({ cwd: f.cwd, resume: true, execute: true }),
      /saved release metadata is invalid/,
    );
    assert.equal(git(f.cwd, ['rev-parse', 'HEAD']), before);
    const writes = readState(join(f.cwd, '.tooling/service.json')).writes;
    assert.deepEqual(writes, []);
  } finally {
    f.cleanup();
  }
});

await test('core task resume keeps saved scope and notes while refreshing code inputs', async () => {
  const f = fixture();
  try {
    for (const [name] of coreReadingList) {
      mkdirSync(join(f.cwd, name, '..'), { recursive: true });
      writeFileSync(join(f.cwd, name), '# Fixture guide\n');
    }
    git(f.cwd, ['add', '.']);
    git(f.cwd, ['commit', '-m', 'docs: fixture guides']);
    const first = await prepare({
      cwd: f.cwd,
      task: 'public-task',
      phase: 'review',
      paths: ['source.txt'],
    });
    const file = join(stateDirectory(f.cwd), 'tasks/public-task/context.json');
    save(file, {
      ...first,
      userContext: 'Approved fix only.',
      dependencies: ['issue-301'],
      remaining: ['Read current review.'],
    });
    writeFileSync(join(f.cwd, 'source.txt'), 'next source');
    git(f.cwd, ['add', 'source.txt']);
    git(f.cwd, ['commit', '-m', 'fix: next source']);
    const resumed = record(
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            join(root, 'tools/task-prepare.mjs'),
            '--core-root',
            f.cwd,
            '--task',
            'public-task',
          ],
          { cwd: f.cwd, encoding: 'utf8' },
        ),
      ),
    );
    assert.equal(resumed.phase, 'review');
    assert.deepEqual(resumed.paths, ['source.txt']);
    assert.equal(resumed.userContext, 'Approved fix only.');
    assert.deepEqual(resumed.dependencies, ['issue-301']);
    assert.deepEqual(resumed.remaining, ['Read current review.']);
    assert.notEqual(resumed.commit, first.commit);
    assert.equal(resumed.commit, git(f.cwd, ['rev-parse', 'HEAD']));
    const explicit = await prepare({
      cwd: f.cwd,
      task: 'public-task',
      phase: 'build',
      paths: [],
    });
    assert.equal(explicit.phase, 'build');
    assert.deepEqual(explicit.paths, []);
    assert.equal(explicit.userContext, 'Approved fix only.');
  } finally {
    f.cleanup();
  }
});

await test('internal task resume leaves omitted phase and paths to the private owner', async () => {
  const f = fixture();
  try {
    const owner = join(f.cwd, '.tooling/cloud');
    mkdirSync(join(owner, 'tools'), { recursive: true });
    writeFileSync(
      join(owner, 'tools/task-prepare.mjs'),
      'console.log(JSON.stringify({args:process.argv.slice(2)}));',
    );
    const resumed = record(
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            join(root, 'tools/task-prepare.mjs'),
            '--core-root',
            f.cwd,
            '--task',
            'internal-task',
            '--internal',
            '--cloud-root',
            owner,
          ],
          { cwd: f.cwd, encoding: 'utf8' },
        ),
      ),
    );
    assert.deepEqual(resumed.args, [
      '--cloud-root',
      owner,
      '--core-root',
      f.cwd,
      '--internal',
      '--task',
      'internal-task',
    ]);
  } finally {
    f.cleanup();
  }
});
