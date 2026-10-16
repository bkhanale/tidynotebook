import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GateError,
  checkRange,
  checkRequiredChecks,
  checkReviews,
  codeRabbit,
  mainRef,
  parseInputs,
  requiredChecks,
  run,
} from './ff-only-merge.mjs';
import { record } from './workspace.mjs';

const api = 'https://api.github.test';
const graphqlUrl = `${api}/graphql`;
const repo = 'owner/repo';
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const H = 'a'.repeat(40);
const old = 'd'.repeat(40);

const rabbit = { login: codeRabbit.login, type: 'Bot', id: codeRabbit.id };
const person = { login: 'person', type: 'User', id: 7 };
const actions = { id: 15368 };

/** @param {number} id @param {object} user @param {string} state @param {string} commit */
const review = (id, user, state, commit = H) => ({
  id,
  user,
  state,
  commit_id: commit,
  submitted_at: `2026-10-16T10:${String(id).padStart(2, '0')}:00Z`,
});

/** The state of a pull request that passes every gate. */
function passing() {
  /** @type {unknown[]} A status is raw API data, also one with no creator. */
  const statuses = [
    { id: 21, context: 'CodeRabbit', state: 'success', creator: rabbit },
    { id: 20, context: 'CodeRabbit', state: 'pending', creator: rabbit },
  ];
  return {
    repository: { id: 1, node_id: 'R_1', full_name: repo },
    pr: {
      number: 5,
      state: 'open',
      merged: false,
      draft: false,
      head: { sha: H, ref: 'topic', repo: { id: 1 } },
      base: { ref: 'main', repo: { id: 1 } },
    },
    main: B,
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_linear_history' },
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'Lint', integration_id: 15368 }],
        },
      },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_reviewers: [],
          allowed_merge_methods: ['rebase'],
        },
      },
    ],
    reviews: [
      review(1, rabbit, 'COMMENTED', old),
      review(2, rabbit, 'APPROVED'),
    ],
    threads: [{ id: 'T1', isResolved: true, isOutdated: true }],
    checkRuns: [
      {
        id: 10,
        name: 'Lint',
        head_sha: H,
        status: 'completed',
        conclusion: 'success',
        app: actions,
      },
    ],
    statuses,
    compare: {
      status: 'ahead',
      ahead_by: 2,
      behind_by: 0,
      merge_base_commit: { sha: B },
    },
    commits: [
      { sha: C, parents: [{ sha: B }] },
      { sha: H, parents: [{ sha: C }] },
    ],
  };
}

/** @typedef {ReturnType<typeof passing>} State */

/**
 * A fake GitHub API. It serves two items per page, so every list is paged.
 * `afterRead` runs once the first snapshot is complete, after its last read. `write` decides the
 * answer to the mutation.
 *
 * @param {State} state
 * @param {{
 *   afterRead?: (state: State) => void,
 *   write?: 'accept' | 'reject' | 'lost' | 'lost-applied',
 * }} [options]
 */
function fakeGitHub(state, options = {}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {unknown[]} */
  const mutations = [];
  let snapshots = 0;
  /** @param {number} status @param {unknown} body @param {string} [link] */
  const reply = (status, body, link) => ({
    status,
    headers: {
      get: (/** @type {string} */ name) =>
        name === 'link' ? (link ?? null) : null,
    },
    text: async () => JSON.stringify(body),
  });
  /** @param {URL} url @param {unknown[]} items @param {(page: unknown[]) => unknown} wrap */
  const paged = (url, items, wrap = (page) => page) => {
    const page = Number(url.searchParams.get('page') ?? '1');
    const slice = items.slice((page - 1) * 2, page * 2);
    const next = new URL(url);
    next.searchParams.set('page', String(page + 1));
    return reply(
      200,
      wrap(slice),
      page * 2 < items.length ? `<${next.href}>; rel="next"` : undefined,
    );
  };
  /** @type {import('./ff-only-merge.mjs').Fetch} */
  const fetch = async (address, init) => {
    calls.push(`${init.method} ${address}`);
    const url = new URL(address);
    if (address === graphqlUrl) {
      const body = record(JSON.parse(init.body ?? '{}'));
      const query = String(body.query);
      const variables = record(body.variables);
      if (query.startsWith('mutation')) {
        mutations.push(variables.input);
        const update = record(list(record(variables.input).refUpdates)[0]);
        if (options.write === 'reject')
          return reply(200, {
            data: { updateRefs: null },
            errors: [
              { message: 'Changes must be made through a pull request.' },
            ],
          });
        if (options.write === 'lost') throw new Error('socket hang up');
        if (update.beforeOid === state.main)
          state.main = String(update.afterOid);
        if (options.write === 'lost-applied') throw new Error('socket hang up');
        return reply(200, { data: { updateRefs: { clientMutationId: null } } });
      }
      const all = state.threads;
      const start = variables.cursor === null ? 0 : Number(variables.cursor);
      const nodes = all.slice(start, start + 2);
      const more = start + 2 < all.length;
      return reply(200, {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                totalCount: all.length,
                pageInfo: { hasNextPage: more, endCursor: String(start + 2) },
                nodes,
              },
            },
          },
        },
      });
    }
    const path = url.pathname;
    const base = `/repos/${repo}`;
    if (path === base) return reply(200, state.repository);
    if (path === `${base}/pulls/5`) return reply(200, state.pr);
    if (path === `${base}/git/ref/heads/main`)
      return reply(200, { ref: mainRef, object: { sha: state.main } });
    if (path === `${base}/rules/branches/main`) return paged(url, state.rules);
    if (path === `${base}/pulls/5/reviews`) return paged(url, state.reviews);
    if (path === `${base}/commits/${state.pr.head.sha}/check-runs`)
      return paged(url, state.checkRuns, (page) => ({
        total_count: state.checkRuns.length,
        check_runs: page,
      }));
    if (path === `${base}/commits/${state.pr.head.sha}/statuses`)
      return paged(url, state.statuses);
    if (path === `${base}/compare/${state.main}...${state.pr.head.sha}`) {
      const answer = paged(url, state.commits, (page) => ({
        ...state.compare,
        commits: page,
      }));
      if (answer.headers.get('link') === null) {
        snapshots += 1;
        if (snapshots === 1) options.afterRead?.(state);
      }
      return answer;
    }
    return reply(404, { message: 'Not Found' });
  };
  return { fetch, calls, mutations };
}

/** @param {unknown} value @returns {unknown[]} */
const list = (value) => (Array.isArray(value) ? value : []);

const env = {
  PR_NUMBER: '5',
  EXPECTED_HEAD_SHA: H,
  DRY_RUN: 'false',
  GITHUB_TOKEN: 'token',
  GITHUB_REPOSITORY: repo,
  GITHUB_REF: mainRef,
  GITHUB_API_URL: api,
  GITHUB_GRAPHQL_URL: graphqlUrl,
};

/**
 * Runs the procedure against a changed passing state and expects a stop with
 * no write.
 *
 * @param {(state: State) => void} change
 * @param {RegExp} message
 */
async function expectStop(change, message) {
  const state = passing();
  change(state);
  const github = fakeGitHub(state);
  const outcome = await run(env, github.fetch);
  assert.equal(outcome.ok, false);
  assert.match(outcome.result, /^Stopped before the write/);
  assert.match(outcome.result, message);
  assert.equal(github.mutations.length, 0);
  assert.equal(state.main, B);
}

await test('the inputs are a positive integer and a full lowercase SHA', () => {
  assert.deepEqual(
    parseInputs({ PR_NUMBER: '397', EXPECTED_HEAD_SHA: H, DRY_RUN: 'true' }),
    { prNumber: 397, expectedHead: H, dryRun: true },
  );
  for (const dryRun of [undefined, '', 'yes', 'TRUE', '1', 'true '])
    assert.throws(
      () =>
        parseInputs({ PR_NUMBER: '5', EXPECTED_HEAD_SHA: H, DRY_RUN: dryRun }),
      /dry run input must be true or false/,
    );
  for (const number of [
    '',
    '0',
    '-1',
    '01',
    '1.5',
    '1e3',
    ' 5',
    '5\n',
    '5;x',
    '9999999999',
  ])
    assert.throws(
      () =>
        parseInputs({
          PR_NUMBER: number,
          EXPECTED_HEAD_SHA: H,
          DRY_RUN: 'false',
        }),
      /positive integer/,
    );
  for (const sha of [
    '',
    H.slice(1),
    H.toUpperCase(),
    `${H}0`,
    `${H.slice(1)}g`,
    'main',
    `$(id)${H.slice(5)}`,
  ])
    assert.throws(
      () =>
        parseInputs({
          PR_NUMBER: '5',
          EXPECTED_HEAD_SHA: sha,
          DRY_RUN: 'false',
        }),
      /40 character lowercase/,
    );
});

await test('a passing pull request moves main from B to H with one compare and swap', async () => {
  const state = passing();
  const github = fakeGitHub(state);
  const outcome = await run(env, github.fetch);
  assert.equal(outcome.ok, true, outcome.result);
  assert.equal(state.main, H);
  assert.deepEqual(github.mutations, [
    {
      repositoryId: 'R_1',
      refUpdates: [
        { name: 'refs/heads/main', beforeOid: B, afterOid: H, force: false },
      ],
    },
  ]);
  assert.match(outcome.summary, /Fast forward main: done/);
  assert.match(outcome.summary, new RegExp(`main after \\| ${H}`));
  assert.ok(
    github.calls.every(
      (call) => call.startsWith('GET ') || call === `POST ${graphqlUrl}`,
    ),
  );
  assert.ok(!github.calls.some((call) => /\/merge\b|\/git\/refs\//.test(call)));
  assert.ok(
    github.calls.some((call) => call.includes(`/commits/${H}/statuses?`)),
  );
  assert.ok(
    !github.calls.some((call) => call.includes(`/commits/${H}/status?`)),
  );
});

await test('a dry run checks every gate twice and never writes', async () => {
  const state = passing();
  const github = fakeGitHub(state);
  const outcome = await run({ ...env, DRY_RUN: 'true' }, github.fetch);
  assert.equal(outcome.ok, true, outcome.result);
  assert.match(
    outcome.result,
    /Every gate holds on a{40}\. This was a dry run/,
  );
  assert.equal(github.mutations.length, 0);
  assert.equal(state.main, B);
  assert.ok(
    github.calls.every(
      (call) => call.startsWith('GET ') || call === `POST ${graphqlUrl}`,
    ),
  );
  assert.equal(
    github.calls.filter((call) => call.includes('/compare/')).length,
    2,
  );

  const blocked = passing();
  blocked.threads = [{ id: 'T1', isResolved: false, isOutdated: false }];
  const stopped = await run(
    { ...env, DRY_RUN: 'true' },
    fakeGitHub(blocked).fetch,
  );
  assert.equal(stopped.ok, false);
  assert.match(stopped.result, /not resolved/);
});

await test('every list is read past its first page', async () => {
  const state = passing();
  state.threads = [
    { id: 'T1', isResolved: true, isOutdated: false },
    { id: 'T2', isResolved: true, isOutdated: false },
    { id: 'T3', isResolved: false, isOutdated: true },
  ];
  state.reviews.push(review(3, person, 'COMMENTED'));
  const github = fakeGitHub(state);
  const outcome = await run(env, github.fetch);
  assert.match(
    outcome.result,
    /1 review thread\(s\) are not resolved, 1 of them outdated/,
  );
  assert.ok(
    github.calls.some((call) =>
      call.includes('/pulls/5/reviews?per_page=100&page=2'),
    ),
  );
  assert.ok(
    github.calls.some((call) =>
      call.includes('/rules/branches/main?per_page=100&page=3'),
    ),
  );
});

await test('the pull request is open, ready, from this repository and into main', async () => {
  await expectStop((state) => {
    state.pr.head.repo = { id: 2 };
  }, /head branch is not in this repository/);
  await expectStop((state) => {
    state.pr.base.repo = { id: 2 };
  }, /belongs to another repository/);
  await expectStop((state) => {
    state.pr.draft = true;
  }, /is a draft/);
  await expectStop((state) => {
    state.pr.base.ref = 'release';
  }, /does not target main/);
  await expectStop((state) => {
    state.pr.state = 'closed';
  }, /is not open/);
});

await test('the head must be the expected SHA', async () => {
  await expectStop((state) => {
    state.pr.head.sha = old;
  }, /The head is dddddddddddd, not the expected aaaaaaaaaaaa/);
});

await test('only a CodeRabbit approval of exactly H counts', async () => {
  await expectStop((state) => {
    state.reviews = [review(1, rabbit, 'APPROVED', old)];
  }, /CodeRabbit approved dddddddddddd, not the head/);
  await expectStop((state) => {
    state.reviews = [];
  }, /CodeRabbit has not approved/);
  await expectStop((state) => {
    state.reviews = [
      review(
        1,
        { ...rabbit, login: 'coderabbit', type: 'User', id: 9 },
        'APPROVED',
      ),
    ];
  }, /CodeRabbit has not approved/);
  await expectStop((state) => {
    state.reviews = [review(1, { ...rabbit, id: 9 }, 'APPROVED')];
  }, /matches CodeRabbit only in part/);
  await expectStop((state) => {
    state.reviews = [review(1, { ...rabbit, type: 'User' }, 'APPROVED')];
  }, /matches CodeRabbit only in part/);
  const other = passing();
  const dependabot = { login: 'dependabot[bot]', type: 'Bot', id: 49699333 };
  other.reviews.push(review(3, dependabot, 'COMMENTED'));
  other.statuses.push({
    id: 5,
    context: 'Other',
    state: 'success',
    creator: dependabot,
  });
  assert.equal((await run(env, fakeGitHub(other).fetch)).ok, true);
});

await test('a green CodeRabbit status without an approval is not enough', async () => {
  await expectStop((state) => {
    state.reviews = [review(1, rabbit, 'COMMENTED')];
  }, /CodeRabbit has not approved/);
});

await test('the CodeRabbit status on H is a success from CodeRabbit', async () => {
  await expectStop((state) => {
    state.statuses = [];
  }, /CodeRabbit has no status/);
  await expectStop((state) => {
    state.statuses = [
      { id: 30, context: 'CodeRabbit', state: 'failure', creator: rabbit },
      ...state.statuses,
    ];
  }, /not a success/);
  await expectStop((state) => {
    state.statuses.push({
      id: 1,
      context: 'CodeRabbit',
      state: 'success',
      creator: person,
    });
  }, /Another account wrote a CodeRabbit status/);
});

await test('the context name alone does not prove who wrote a status', async () => {
  await expectStop((state) => {
    state.statuses = [
      { id: 30, context: 'CodeRabbit', state: 'success', creator: null },
      ...state.statuses,
    ];
  }, /Another account wrote a CodeRabbit status/);
  await expectStop((state) => {
    state.statuses = [{ id: 30, context: 'CodeRabbit', state: 'success' }];
  }, /Another account wrote a CodeRabbit status/);
  await expectStop((state) => {
    state.statuses = [
      {
        id: 30,
        context: 'CodeRabbit',
        state: 'success',
        creator: { login: codeRabbit.login, type: 'Bot' },
      },
    ];
  }, /matches CodeRabbit only in part/);
});

await test('the latest review of each reviewer decides', () => {
  assert.throws(
    () =>
      checkReviews(
        [
          review(1, person, 'APPROVED'),
          review(2, person, 'CHANGES_REQUESTED'),
          review(3, rabbit, 'APPROVED'),
        ],
        H,
      ),
    /person requests changes/,
  );
  checkReviews(
    [
      review(1, person, 'CHANGES_REQUESTED'),
      review(2, person, 'APPROVED'),
      review(3, rabbit, 'APPROVED'),
    ],
    H,
  );
  checkReviews(
    [
      review(1, person, 'CHANGES_REQUESTED'),
      review(2, person, 'COMMENTED'),
      review(3, rabbit, 'APPROVED'),
    ].map((item) => (item.id === 1 ? { ...item, state: 'DISMISSED' } : item)),
    H,
  );
  assert.throws(
    () =>
      checkReviews(
        [review(1, rabbit, 'APPROVED'), review(2, rabbit, 'CHANGES_REQUESTED')],
        H,
      ),
    /requests changes/,
  );
  checkReviews(
    [review(1, rabbit, 'APPROVED'), review(2, rabbit, 'COMMENTED', old)],
    H,
  );
  const later = {
    ...review(1, rabbit, 'CHANGES_REQUESTED'),
    submitted_at: '2026-10-16T12:00:00Z',
  };
  assert.throws(
    () => checkReviews([later, review(2, rabbit, 'APPROVED')], H),
    /requests changes/,
  );
});

await test('every review thread is resolved, also an outdated one', async () => {
  await expectStop((state) => {
    state.threads = [{ id: 'T1', isResolved: false, isOutdated: false }];
  }, /1 review thread\(s\) are not resolved, 0 of them outdated/);
  await expectStop((state) => {
    state.threads = [{ id: 'T1', isResolved: false, isOutdated: true }];
  }, /1 of them outdated/);
});

await test('every required check succeeds on H from its named app', async () => {
  const required = [{ context: 'Lint', integrationId: 15368 }];
  const lint = passing().checkRuns[0];
  assert.throws(
    () => checkRequiredChecks(required, [], [], H),
    /"Lint" has no result/,
  );
  assert.throws(
    () => checkRequiredChecks(required, [{ ...lint, app: { id: 1 } }], [], H),
    /"Lint" has no result/,
  );
  assert.throws(
    () =>
      checkRequiredChecks(
        required,
        [],
        [{ id: 1, context: 'Lint', state: 'success' }],
        H,
      ),
    /"Lint" has no result/,
  );
  assert.throws(
    () => checkRequiredChecks(required, [{ ...lint, head_sha: old }], [], H),
    /"Lint" has no result/,
  );
  assert.throws(
    () =>
      checkRequiredChecks(
        required,
        [{ ...lint, conclusion: 'failure' }],
        [],
        H,
      ),
    /did not succeed/,
  );
  assert.throws(
    () =>
      checkRequiredChecks(
        required,
        [lint, { ...lint, id: 11, status: 'in_progress', conclusion: null }],
        [],
        H,
      ),
    /did not succeed/,
  );
  checkRequiredChecks(
    required,
    [lint, { ...lint, id: 9, conclusion: 'failure' }],
    [],
    H,
  );
  checkRequiredChecks(
    [{ context: 'Docs', integrationId: null }],
    [],
    [{ id: 1, context: 'Docs', state: 'success' }],
    H,
  );
  assert.throws(
    () =>
      checkRequiredChecks(
        [{ context: 'Docs', integrationId: null }],
        [],
        [
          { id: 2, context: 'Docs', state: 'failure' },
          { id: 1, context: 'Docs', state: 'success' },
        ],
        H,
      ),
    /did not succeed/,
  );
  await expectStop((state) => {
    state.checkRuns = [];
  }, /"Lint" has no result/);
});

await test('a rule that the gate does not evaluate stops it', () => {
  const rules = passing().rules;
  assert.deepEqual(requiredChecks(rules), [
    { context: 'Lint', integrationId: 15368 },
  ]);
  assert.throws(
    () => requiredChecks([...rules, { type: 'update' }]),
    /rule "update"/,
  );
  assert.throws(
    () => requiredChecks([...rules, { type: 'merge_queue' }]),
    /rule "merge_queue"/,
  );
  assert.throws(
    () =>
      requiredChecks(
        rules.map((rule) =>
          rule.type === 'pull_request'
            ? {
                ...rule,
                parameters: {
                  ...rule.parameters,
                  required_approving_review_count: 1,
                },
              }
            : rule,
        ),
      ),
    /requires approvals/,
  );
  assert.throws(
    () => requiredChecks(rules.slice(0, 3)),
    /no required status check/,
  );
});

await test('main must be an ancestor of H with no merge commit between them', async () => {
  const state = passing();
  checkRange(state.compare, state.commits, B, H);
  assert.throws(
    () =>
      checkRange(
        { ...state.compare, status: 'diverged', behind_by: 1 },
        state.commits,
        B,
        H,
      ),
    /not an ancestor/,
  );
  assert.throws(
    () => checkRange({ ...state.compare, status: 'identical' }, [], B, H),
    /already points/,
  );
  assert.throws(
    () =>
      checkRange(
        { ...state.compare, merge_base_commit: { sha: old } },
        state.commits,
        B,
        H,
      ),
    /merge base/,
  );
  assert.throws(
    () => checkRange({ ...state.compare, ahead_by: 300 }, state.commits, B, H),
    /every commit/,
  );
  await expectStop((changed) => {
    changed.commits[0] = { sha: C, parents: [{ sha: B }, { sha: old }] };
  }, /cccccccccccc is a merge commit/);
});

await test('any change between the two reads stops the write', async () => {
  /** @type {((state: State) => void)[]} */
  const changes = [
    (state) => state.reviews.push(review(3, person, 'COMMENTED')),
    (state) =>
      state.threads.push({ id: 'T2', isResolved: true, isOutdated: false }),
    (state) =>
      state.statuses.unshift({
        id: 22,
        context: 'CodeRabbit',
        state: 'success',
        creator: rabbit,
      }),
    (state) =>
      state.checkRuns.push({
        id: 12,
        name: 'Other',
        head_sha: H,
        status: 'completed',
        conclusion: 'success',
        app: actions,
      }),
    (state) => {
      state.main = C;
      state.compare = {
        ...state.compare,
        ahead_by: 1,
        merge_base_commit: { sha: C },
      };
      state.commits = state.commits.slice(1);
    },
  ];
  for (const change of changes) {
    const state = passing();
    const github = fakeGitHub(state, { afterRead: change });
    const outcome = await run(env, github.fetch);
    assert.equal(outcome.ok, false);
    assert.match(outcome.result, /changed between the two reads/);
    assert.equal(github.mutations.length, 0);
  }
  const moved = passing();
  const github = fakeGitHub(moved, {
    afterRead: (state) => {
      state.pr.head.sha = old;
    },
  });
  assert.match(
    (await run(env, github.fetch)).result,
    /The head is dddddddddddd/,
  );
  assert.equal(github.mutations.length, 0);
});

await test('a rejected write is reported once and never retried', async () => {
  const state = passing();
  const github = fakeGitHub(state, { write: 'reject' });
  const outcome = await run(env, github.fetch);
  assert.equal(outcome.ok, false);
  assert.match(
    outcome.result,
    /GitHub rejected the update: Changes must be made through a pull request\. main is at b{40}/,
  );
  assert.equal(github.mutations.length, 1);
  assert.equal(state.main, B);
});

await test('a lost answer is settled by reading main back, with no retry', async () => {
  const lost = passing();
  const notApplied = fakeGitHub(lost, { write: 'lost' });
  const first = await run(env, notApplied.fetch);
  assert.equal(first.ok, false);
  assert.match(
    first.result,
    /unclear \(socket hang up\)\. main is at b{40}\. Nothing was retried/,
  );
  assert.equal(notApplied.mutations.length, 1);

  const applied = passing();
  const github = fakeGitHub(applied, { write: 'lost-applied' });
  const second = await run(env, github.fetch);
  assert.equal(second.ok, true);
  assert.match(
    second.result,
    /unclear \(socket hang up\), but main is at a{40}/,
  );
  assert.equal(github.mutations.length, 1);
});

await test('the run stops outside main and never sends the token to another host', async () => {
  const state = passing();
  const github = fakeGitHub(state);
  const outcome = await run(
    { ...env, GITHUB_REF: 'refs/heads/topic' },
    github.fetch,
  );
  assert.match(outcome.result, /must run from main/);
  assert.equal(github.calls.length, 0);

  /** @type {import('./ff-only-merge.mjs').Fetch} */
  const redirect = async (address, init) => {
    const reply = await github.fetch(address, init);
    return address.includes('/rules/')
      ? {
          ...reply,
          headers: { get: () => '<https://evil.test/x>; rel="next"' },
        }
      : reply;
  };
  const before = github.calls.length;
  assert.match((await run(env, redirect)).result, /outside its API/);
  assert.ok(github.calls.slice(before).every((call) => call.includes(api)));
  assert.ok(new GateError('x') instanceof Error);
});
