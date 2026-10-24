import assert from 'node:assert/strict';
import test from 'node:test';
import {
  repository,
  requireEnvironment,
  requireProof,
  versionFromRef,
} from './release-workflow.mjs';

const sha = 'a'.repeat(40);
const run = {
  id: 100,
  event: 'push',
  head_sha: sha,
  head_repository: { full_name: repository },
  path: '.github/workflows/ci.yml',
  check_suite_id: 20,
  head_branch: 'ci/example',
};
const check = {
  id: 200,
  name: 'Check',
  head_sha: sha,
  app: { id: 15368 },
  check_suite: { id: 20 },
  status: 'completed',
  conclusion: 'success',
};

await test('release accepts stable tags and main only', () => {
  assert.equal(versionFromRef('refs/heads/main'), 'main');
  assert.equal(versionFromRef('refs/tags/v1.2.3'), '1.2.3');
  for (const ref of [
    'refs/heads/feature',
    'refs/tags/v01.2.3',
    'refs/tags/v1.2.3-rc.1',
    'refs/tags/v1.2.3+build',
    'refs/tags/v1.2',
    'refs/tags/v1.2.3/inject',
  ])
    assert.throws(() => versionFromRef(ref));
});

await test('the exact source accepts its PR branch push Check from GitHub Actions', () => {
  requireProof([run], [check], sha);
  for (const bad of [
    { event: 'pull_request' },
    { head_sha: 'b'.repeat(40) },
    { head_repository: { full_name: 'fork/core' } },
    { path: '.github/workflows/other.yml' },
  ])
    assert.throws(() => requireProof([{ ...run, ...bad }], [check], sha));
  for (const bad of [
    { app: { id: 1 } },
    { head_sha: 'b'.repeat(40) },
    { check_suite: { id: 21 } },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { name: 'other' },
  ])
    assert.throws(() => requireProof([run], [{ ...check, ...bad }], sha));
  assert.throws(() =>
    requireProof([run, { ...run, id: 101, check_suite_id: 21 }], [check], sha),
  );
  assert.throws(() =>
    requireProof(
      [run],
      [check, { ...check, id: 201, conclusion: 'failure' }],
      sha,
    ),
  );
});

const environment = {
  name: 'release',
  can_admins_bypass: false,
  deployment_branch_policy: {
    protected_branches: false,
    custom_branch_policies: true,
  },
  protection_rules: [],
};

await test('version protection accepts an environment with no reviewer rule', () => {
  requireEnvironment(environment);
  requireEnvironment({
    ...environment,
    protection_rules: [{ type: 'branch_policy' }],
  });
});

await test('version protection refuses every required-reviewer rule', () => {
  for (const reviewers of [
    [],
    [{ type: 'User', reviewer: { id: 23272598 } }],
    [{ type: 'User', reviewer: { id: 1 } }],
    [{ type: 'Team', reviewer: { id: 1 } }],
  ]) {
    assert.throws(
      () =>
        requireEnvironment({
          ...environment,
          protection_rules: [
            { type: 'branch_policy' },
            {
              type: 'required_reviewers',
              prevent_self_review: false,
              reviewers,
            },
          ],
        }),
      /Remove required reviewers/,
    );
  }
});

await test('version protection keeps the environment name, bypass and branch-policy guards', () => {
  for (const change of [
    { name: 'other' },
    { can_admins_bypass: true },
    { can_admins_bypass: undefined },
    { protection_rules: undefined },
    { protection_rules: {} },
    { protection_rules: [null] },
    { deployment_branch_policy: null },
    {
      deployment_branch_policy: {
        protected_branches: true,
        custom_branch_policies: true,
      },
    },
    {
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: false,
      },
    },
  ])
    assert.throws(() => requireEnvironment({ ...environment, ...change }));
});
