import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { record, root } from './workspace.mjs';
import { checkResults } from './ci-check.mjs';

/** @param {unknown} value
 * @returns {value is {load: (source: string) => unknown}} */
function yamlModule(value) {
  return typeof record(value).load === 'function';
}

/** Read a YAML file of the repository with the installed parser.
 * @param {string} path */
async function loadYaml(path) {
  const web = createRequire(join(root, 'apps/web/package.json'));
  const mermaid = createRequire(web.resolve('mermaid'));
  const parser = createRequire(mermaid.resolve('chevrotain'));
  /** @type {unknown} */
  const yaml = parser('js-yaml');
  assert.ok(yamlModule(yaml));
  return record(yaml.load(await readFile(join(root, path), 'utf8')));
}

await test('CI selects hosted checks and has one fail-closed aggregate', async () => {
  const workflow = await loadYaml('.github/workflows/ci.yml');
  assert.deepEqual(Object.keys(record(workflow.on)), [
    'push',
    'pull_request',
    'workflow_dispatch',
    'schedule',
  ]);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.concurrency, {
    group: 'ci-${{ github.event_name }}-${{ github.ref }}',
    'cancel-in-progress': "${{ github.ref != 'refs/heads/main' }}",
  });
  const jobs = record(workflow.jobs);
  assert.deepEqual(record(jobs.scope).permissions, {
    contents: 'read',
    checks: 'read',
    actions: 'read',
  });
  for (const [name, job] of Object.entries(jobs))
    if (name !== 'scope')
      assert.equal(record(record(job).permissions).checks, undefined);
  for (const [name, value] of Object.entries(jobs)) {
    const job = record(value);
    assert.equal(
      job['runs-on'],
      name === 'image_arm64' ? 'ubuntu-24.04-arm' : 'ubuntu-latest',
    );
    assert.ok(typeof job['timeout-minutes'] === 'number');
  }
  assert.deepEqual(
    record(record(record(jobs.unit).strategy).matrix).shard,
    [1, 2, 3],
  );
  assert.deepEqual(
    record(record(record(jobs.integration).strategy).matrix).shard,
    [1, 2, 3, 4],
  );
  const staticSteps = record(jobs.static).steps;
  assert.ok(Array.isArray(staticSteps));
  const documents = staticSteps
    .map(record)
    .find((step) => step.name === 'Check documents');
  assert.equal(
    record(documents?.env).DOCS_BASE,
    '${{ github.event.pull_request.base.sha || github.event.before }}',
  );
  assert.deepEqual(record(jobs.workflows).needs, ['scope', 'static']);
  assert.match(String(record(jobs.workflows).if), /!cancelled\(\)/);
  assert.equal(record(jobs.nightly).needs, 'check');
  assert.equal(
    record(jobs.nightly).if,
    "${{ !cancelled() && needs.check.result == 'success' && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')) }}",
  );
  assert.equal(record(record(jobs.image).permissions).packages, 'read');
  assert.equal(record(record(jobs.image_main).permissions).packages, 'write');
  assert.equal(record(jobs.image_main).needs, 'scope');
  assert.equal(record(jobs.image).needs, 'scope');
  assert.match(
    String(record(jobs.image_main).if),
    /github.ref == 'refs\/heads\/main'/,
  );
  assert.match(
    String(record(jobs.image).if),
    /github.ref != 'refs\/heads\/main'/,
  );
  assert.match(
    String(record(jobs.check).name),
    /'Use push checks' \|\| 'Check'/,
  );
  assert.deepEqual(record(jobs.check).needs, [
    'scope',
    'static',
    'unit',
    'integration',
    'image',
    'image_main',
    'image_arm64',
    'workflows',
  ]);
  assert.equal(record(jobs.image_arm64).needs, 'scope');
  assert.equal(
    record(jobs.image_arm64).if,
    "needs.scope.outputs.image == 'true'",
  );
  assert.equal(record(jobs.image_arm64)['runs-on'], 'ubuntu-24.04-arm');
  assert.match(String(record(jobs.check).if), /always\(\)/);
  assert.match(
    String(record(jobs.scope).if),
    /head.repo.full_name != github.repository/,
  );
});

await test('only main saves the dependency cache', async () => {
  const setup = await loadYaml('.github/actions/setup/action.yml');
  const steps = record(setup.runs).steps;
  assert.ok(Array.isArray(steps));
  const actions = steps.map(record);
  const save = actions.find((step) =>
    String(step.uses).startsWith('actions/cache/save@'),
  );
  assert.match(String(save?.if), /github.ref == 'refs\/heads\/main'/);
  assert.ok(
    actions.some((step) =>
      String(step.uses).startsWith('actions/cache/restore@'),
    ),
  );
  assert.ok(
    !actions.some((step) => String(step.uses).startsWith('actions/cache@')),
  );
});

await test('Dependabot opens its pull requests monthly', async () => {
  const config = await loadYaml('.github/dependabot.yml');
  const updates = Array.isArray(config.updates) ? config.updates : [];
  assert.ok(updates.length > 0);
  for (const update of updates)
    assert.equal(record(record(update).schedule).interval, 'monthly');
});

await test('the fast forward workflow runs trusted code by hand with narrow access', async () => {
  const path = '.github/workflows/ff-only-merge.yml';
  const workflow = await loadYaml(path);
  const on = record(workflow.on);
  assert.deepEqual(Object.keys(on), ['workflow_dispatch']);
  const inputs = record(record(on.workflow_dispatch).inputs);
  assert.deepEqual(Object.keys(inputs), [
    'pr_number',
    'expected_head_sha',
    'dry_run',
  ]);
  for (const input of Object.values(inputs))
    assert.equal(record(input).required, true);
  assert.equal(record(inputs.dry_run).type, 'boolean');
  assert.equal(record(inputs.dry_run).default, true);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(record(record(workflow.jobs)['fast-forward']).permissions, {
    contents: 'write',
    'pull-requests': 'read',
    checks: 'read',
    statuses: 'read',
  });
  assert.deepEqual(workflow.concurrency, {
    group: 'ff-only-main',
    'cancel-in-progress': false,
    queue: 'max',
  });
  const jobs = Object.entries(record(workflow.jobs))
    .filter(([name]) => name !== 'dispatch-release')
    .map(([, job]) => record(job));
  assert.equal(jobs.length, 1);
  const job = record(jobs[0]);
  assert.equal(job.if, "github.ref == 'refs/heads/main'");
  assert.ok(typeof job['timeout-minutes'] === 'number');
  assert.equal(record(job.permissions).actions, undefined);
  const steps = Array.isArray(job.steps) ? job.steps.map(record) : [];
  const checkouts = steps.filter((step) =>
    String(step.uses).startsWith('actions/checkout@'),
  );
  assert.equal(checkouts.length, 1);
  const checkout = record(checkouts[0]?.with);
  assert.equal(checkout.ref, '${{ github.workflow_sha }}');
  assert.equal(checkout['persist-credentials'], false);
  assert.equal(checkout.repository, undefined);
  const runs = steps.filter((step) => step.run !== undefined);
  assert.deepEqual(
    runs.map((step) => step.run),
    ['node tools/ff-only-merge.mjs'],
  );
  assert.deepEqual(record(runs[0]?.env), {
    GITHUB_TOKEN: '${{ github.token }}',
    PR_NUMBER: '${{ inputs.pr_number }}',
    EXPECTED_HEAD_SHA: '${{ inputs.expected_head_sha }}',
    DRY_RUN: '${{ inputs.dry_run }}',
  });
  const source = await readFile(join(root, path), 'utf8');
  const uses = [...source.matchAll(/^\s*- uses: (.+)$/gm)].map(
    (match) => match[1] ?? '',
  );
  assert.equal(uses.length, steps.filter((step) => step.uses).length);
  for (const line of uses)
    assert.match(line, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  assert.doesNotMatch(source, /secrets\./);
});

await test('the comment workflow runs trusted code on new comments with narrow access', async () => {
  const path = '.github/workflows/ff-merge-comment.yml';
  const workflow = await loadYaml(path);
  assert.deepEqual(workflow.on, { issue_comment: { types: ['created'] } });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(record(record(workflow.jobs)['fast-forward']).permissions, {
    contents: 'write',
    'pull-requests': 'write',
    checks: 'read',
    statuses: 'read',
  });
  assert.equal(workflow.concurrency, undefined);
  const jobs = Object.entries(record(workflow.jobs))
    .filter(([name]) => name !== 'dispatch-release')
    .map(([, job]) => record(job));
  assert.equal(jobs.length, 1);
  const job = record(jobs[0]);
  for (const part of [
    "github.ref == 'refs/heads/main'",
    'github.event.issue.pull_request',
    "github.event.comment.user.type == 'User'",
    "startsWith(github.event.comment.body, '/ff-merge')",
    'github.event.comment.author_association',
  ])
    assert.ok(String(job.if).includes(part), part);
  assert.deepEqual(job.concurrency, {
    group: 'ff-only-main',
    'cancel-in-progress': false,
    queue: 'max',
  });
  assert.ok(typeof job['timeout-minutes'] === 'number');
  assert.equal(record(job.permissions).actions, undefined);
  const steps = Array.isArray(job.steps) ? job.steps.map(record) : [];
  const checkout = record(
    steps.find((step) => String(step.uses).startsWith('actions/checkout@'))
      ?.with,
  );
  assert.equal(checkout.ref, '${{ github.workflow_sha }}');
  assert.equal(checkout['persist-credentials'], false);
  const runs = steps.filter((step) => step.run !== undefined);
  assert.deepEqual(
    runs.map((step) => step.run),
    ['node tools/ff-merge-comment.mjs'],
  );
  assert.deepEqual(record(runs[0]?.env), {
    GITHUB_TOKEN: '${{ github.token }}',
    PR_NUMBER: '${{ github.event.issue.number }}',
    COMMENT_ID: '${{ github.event.comment.id }}',
    COMMENT_USER_ID: '${{ github.event.comment.user.id }}',
    COMMENT_USER_LOGIN: '${{ github.event.comment.user.login }}',
    COMMENT_CREATED_AT: '${{ github.event.comment.created_at }}',
  });
  const source = await readFile(join(root, path), 'utf8');
  for (const match of source.matchAll(/^\s*- uses: (.+)$/gm))
    assert.match(
      match[1] ?? '',
      /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
    );
  assert.doesNotMatch(source, /secrets\.|comment\.body \}\}/);
});

await test('the image composite uses the job token and exports only on main', async () => {
  const source = await readFile(
    join(root, '.github/actions/image/action.yml'),
    'utf8',
  );
  assert.doesNotMatch(source, /secrets\./);
  const action = await loadYaml('.github/actions/image/action.yml');
  const steps = record(action.runs).steps;
  assert.ok(Array.isArray(steps));
  const login = steps
    .map(record)
    .find((step) => String(step.uses).startsWith('docker/login-action@'));
  assert.match(String(login?.if), /github.ref == 'refs\/heads\/main'/);
  assert.equal(record(login?.with).password, '${{ github.token }}');
});

await test('checkResults rejects every failed, cancelled or skipped selected job', () => {
  for (const main of [false, true]) {
    const jobs = {
      scope: {
        result: 'success',
        outputs: { source: 'true', image: 'true', workflows: 'true' },
      },
      static: { result: 'success' },
      unit: { result: 'success' },
      integration: { result: 'success' },
      image: { result: main ? 'skipped' : 'success' },
      image_main: { result: main ? 'success' : 'skipped' },
      image_arm64: { result: 'success' },
      workflows: { result: 'success' },
    };
    checkResults(jobs, main);
    for (const job of Object.values(jobs).filter(
      (item) => item.result === 'success',
    )) {
      for (const result of ['failure', 'cancelled', 'skipped']) {
        job.result = result;
        assert.throws(() => checkResults(jobs, main), /passing result/);
      }
      job.result = 'success';
    }
  }
});

await test('both merge paths dispatch main publication with isolated Actions write access', async () => {
  for (const name of ['ff-only-merge', 'ff-merge-comment']) {
    const workflow = await loadYaml(`.github/workflows/${name}.yml`);
    const jobs = record(workflow.jobs);
    const dispatch = record(jobs['dispatch-release']);
    assert.equal(dispatch.needs, 'fast-forward');
    assert.deepEqual(dispatch.permissions, { actions: 'write' });
    assert.equal(record(workflow.permissions).actions, undefined);
    assert.equal(
      record(record(jobs['fast-forward']).permissions).actions,
      undefined,
    );
    assert.equal(
      dispatch.if,
      name === 'ff-only-merge' ? 'inputs.dry_run == false' : undefined,
    );
    const steps = Array.isArray(dispatch.steps)
      ? dispatch.steps.map(record)
      : [];
    assert.equal(steps.length, 1);
    assert.equal(
      steps[0]?.run,
      'gh api --method POST repos/tidynotebook/tidynotebook/actions/workflows/release.yml/dispatches -f ref=main',
    );
    assert.deepEqual(steps[0]?.env, { GH_TOKEN: '${{ github.token }}' });
  }
});

await test('release proves both native images before the only publication jobs', async () => {
  const workflow = await loadYaml('.github/workflows/release.yml');
  assert.deepEqual(workflow.on, {
    push: { branches: ['main'], tags: ['v[0-9]*.[0-9]*.[0-9]*'] },
    workflow_dispatch: null,
  });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.concurrency, {
    group: 'release-core',
    'cancel-in-progress': false,
  });
  const jobs = record(workflow.jobs);
  const build = record(jobs.build);
  assert.equal(build.needs, 'prepare');
  assert.deepEqual(record(record(build.strategy).matrix).include, [
    { arch: 'amd64', runner: 'ubuntu-latest' },
    { arch: 'arm64', runner: 'ubuntu-24.04-arm' },
  ]);
  const steps = Array.isArray(build.steps) ? build.steps.map(record) : [];
  const proof = steps.findIndex(
    (step) =>
      step.run === 'node --test tests/image/distribution-notices.test.ts',
  );
  const upload = steps.findIndex((step) =>
    String(step.uses).startsWith('actions/upload-artifact@'),
  );
  assert.ok(proof >= 0 && upload > proof);
  assert.equal(record(steps[upload]?.with)['retention-days'], 1);
  const commands = steps.map((step) => String(step.run)).join('\n');
  assert.match(
    commands,
    /--cache-from "type=registry,ref=ghcr.io\/tidynotebook\/tidynotebook\/ci-cache:\$ARCH"/,
  );
  assert.doesNotMatch(commands, /--push|--cache-to/);
  for (const [name, raw] of Object.entries(jobs)) {
    const job = record(raw);
    assert.ok(typeof job['timeout-minutes'] === 'number');
    const publish = name.startsWith('publish_');
    for (const permission of ['packages', 'id-token', 'attestations'])
      assert.equal(
        record(job.permissions)[permission],
        publish ? 'write' : undefined,
      );
    if (publish) assert.deepEqual(job.needs, ['prepare', 'build']);
  }
  assert.equal(record(jobs.publish_main).environment, undefined);
  assert.equal(
    record(jobs.publish_main).if,
    "needs.prepare.outputs.version == 'main'",
  );
  assert.equal(record(jobs.publish_release).environment, 'release');
  assert.equal(
    record(jobs.publish_release).if,
    "needs.prepare.outputs.version != 'main'",
  );
  const action = await loadYaml('.github/actions/publish-core/action.yml');
  const publication = record(action.runs).steps;
  assert.ok(Array.isArray(publication));
  const attest = publication
    .map(record)
    .find((step) =>
      String(step.uses).startsWith('actions/attest-build-provenance@'),
    );
  assert.equal(record(attest?.with)['push-to-registry'], true);
  for (const path of [
    '.github/workflows/release.yml',
    '.github/actions/publish-core/action.yml',
  ]) {
    const source = await readFile(join(root, path), 'utf8');
    assert.doesNotMatch(source, /secrets\./);
    for (const match of source.matchAll(/^\s*- uses: (?!\.\/)(.+)$/gm))
      assert.match(match[1] ?? '', /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v/);
  }
  const ci = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(
    ci,
    /actionlint" \.github\/workflows\/ci.yml \.github\/workflows\/release.yml/,
  );
});
