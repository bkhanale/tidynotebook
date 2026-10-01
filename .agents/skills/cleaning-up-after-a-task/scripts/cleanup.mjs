/**
 * Cleans the development machine of the owner after a task.
 *
 * Usage, from any checkout of the repository:
 *
 *     node .agents/skills/cleaning-up-after-a-task/scripts/cleanup.mjs plan
 *     node .agents/skills/cleaning-up-after-a-task/scripts/cleanup.mjs apply [--also <name>]...
 *
 * `plan` fetches `origin` and changes nothing else. It prints one line for
 * each worktree, each branch on this machine and on `origin`, the shared test
 * database, the local Docker deployment, and the Docker prune. Each line
 * starts with what `apply` does to that item:
 *
 * - `remove`, `delete`, `deploy`, `prune`: `apply` does it.
 * - `keep`: the item stays, and the line states why.
 * - `ask`: the item holds work that exists nowhere else. It stays unless
 *   `apply` names it with `--also <name>`.
 * - `skip`: the step cannot run on this machine, and the line states why.
 *
 * `apply` makes the plan again from the state of now, so a plan that is old
 * never acts. It runs the steps in order and stops at the first step that
 * fails. A second `apply` continues from the state that the first one left.
 *
 * The machine is for development only and holds nothing to keep, so the
 * script takes no backup of the database or of the stored files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join, sep } from 'node:path';
import process from 'node:process';

const mainBranch = 'main';
const remote = 'origin';
// The Compose project of the shared test PostgreSQL service. It is the name
// that `tools/test-database/ensure-postgres.sh` starts and finds it by.
const testProject = 'notesapp-test';
// The script that stops the application of one worktree and removes its
// database and its file store, relative to the root of that worktree.
const appScript = '.agents/skills/testing-changes-end-to-end/scripts/app.mjs';
// The deployment applies its migrations before it reports healthy. Its health
// check runs every 10 seconds after a start period of 10 seconds, so a good
// start is healthy inside one minute. Five minutes covers a long migration and
// still ends a start that never becomes healthy.
const healthTimeoutMs = 5 * 60 * 1000;
// The health state is read every two seconds while the deployment starts.
const healthPollMs = 2000;
// The ready probe answers at once on a healthy server. Ten seconds ends a
// probe that hangs.
const readyTimeoutMs = 10 * 1000;

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} Outcome
 * @typedef {{ path: string, head: string, branch: string | null }} Worktree
 * @typedef {'remove' | 'delete' | 'deploy' | 'prune' | 'keep' | 'ask' | 'skip'} Mark
 * @typedef {{ mark: Mark, name: string, reason: string }} Line
 * @typedef {{ worktree: Line[], branch: Line[], remoteBranch: Line[], testDatabase: Line[], deployment: Line[], prune: Line[] }} Plan
 */

/**
 * Runs one command and returns what it printed. It never throws.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Outcome}
 */
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? result.error?.message ?? '').trim(),
  };
}

/**
 * Runs one command and returns its output, or throws with its error output.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 */
function must(command, args, cwd) {
  const outcome = run(command, args, cwd);
  if (outcome.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${outcome.stderr || outcome.stdout}`,
    );
  return outcome.stdout;
}

/** @param {string} text */
function lines(text) {
  return text === '' ? [] : text.split('\n');
}

/** @param {number} count @param {string} one @param {string} many */
function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Every worktree of the repository. The first one is the main checkout.
 *
 * @param {string} cwd
 * @returns {Worktree[]}
 */
function worktrees(cwd) {
  /** @type {Worktree[]} */
  const found = [];
  for (const block of must('git', ['worktree', 'list', '--porcelain'], cwd)
    .split('\n\n')
    .filter((entry) => entry.trim() !== '')) {
    /** @type {Worktree} */
    const entry = { path: '', head: '', branch: null };
    for (const line of lines(block)) {
      if (line.startsWith('worktree ')) entry.path = line.slice(9);
      if (line.startsWith('HEAD ')) entry.head = line.slice(5);
      if (line.startsWith('branch refs/heads/'))
        entry.branch = line.slice('branch refs/heads/'.length);
    }
    found.push(entry);
  }
  if (found.length === 0) throw new Error('git lists no worktree.');
  return found;
}

/**
 * How many commits of a reference have no equal change in `main`.
 *
 * `git cherry` compares the changes, not the commit names, so a branch that
 * landed through a rebase counts as landed. It leaves merge commits out, so
 * a merge that is not in `main` counts here when it carries a change of its
 * own, such as a conflict resolution. A merge with no such change shows an
 * empty combined diff, and it adds nothing that its parents do not hold.
 *
 * @param {string} reference
 * @param {string} cwd
 */
function commitsOutsideMain(reference, cwd) {
  const patches = lines(
    must('git', ['cherry', mainBranch, reference], cwd),
  ).filter((line) => line.startsWith('+')).length;
  const merges = lines(
    must('git', ['rev-list', '--merges', `${mainBranch}..${reference}`], cwd),
  ).filter(
    (merge) => must('git', ['show', '--cc', '--format=', merge], cwd) !== '',
  ).length;
  return patches + merges;
}

/**
 * The ignored files of a worktree that a build or a test can make again.
 *
 * `git worktree remove` deletes every ignored file with the worktree. Build
 * output, installed packages and the state of the local application come
 * back on the next install, build or start. Anything else that git ignores,
 * such as `.env`, a secret or a data directory, may exist only there.
 */
const disposableDirectories = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.tooling',
  '.local-app',
]);
const disposableSuffixes = ['.tsbuildinfo', '.DS_Store'];

/**
 * The ignored paths of a worktree that no build or test makes again.
 *
 * @param {string} path
 */
function keptIgnoredFiles(path) {
  return must(
    'git',
    [
      'status',
      '--porcelain',
      '--ignored=matching',
      '--untracked-files=normal',
      '-z',
    ],
    path,
  )
    .split('\0')
    .filter((entry) => entry.startsWith('!! '))
    .map((entry) => entry.slice(3))
    .filter(
      (file) =>
        !file
          .split('/')
          .some((segment) => disposableDirectories.has(segment)) &&
        !disposableSuffixes.some((suffix) => file.endsWith(suffix)),
    );
}

/**
 * The head branches of the open pull requests on GitHub.
 *
 * @param {string} cwd
 * @returns {Set<string>}
 */
function openPullRequestBranches(cwd) {
  const outcome = run(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '1000',
      '--json',
      'headRefName',
    ],
    cwd,
  );
  if (outcome.status !== 0)
    throw new Error(
      `gh cannot list the open pull requests, so no branch is safe to delete. Run gh auth status.\n${outcome.stderr}`,
    );
  /** @type {unknown} */
  const value = JSON.parse(outcome.stdout);
  if (!Array.isArray(value))
    throw new Error('gh pr list did not return a list.');
  /** @type {Set<string>} */
  const names = new Set();
  for (const entry of value) {
    /** @type {unknown} */
    const name =
      entry !== null && typeof entry === 'object'
        ? Reflect.get(entry, 'headRefName')
        : undefined;
    if (typeof name !== 'string')
      throw new Error('gh pr list returned an entry with no head branch.');
    names.add(name);
  }
  return names;
}

/** @param {string} cwd */
function dockerAvailable(cwd) {
  return (
    run('docker', ['info', '--format', '{{.ServerVersion}}'], cwd).status === 0
  );
}

/**
 * The containers of the shared test PostgreSQL service, by name.
 *
 * @param {string} cwd
 */
function testContainers(cwd) {
  return lines(
    must(
      'docker',
      [
        'ps',
        '--all',
        '--filter',
        `label=com.docker.compose.project=${testProject}`,
        '--format',
        '{{.Names}}',
      ],
      cwd,
    ),
  );
}

/**
 * The values of a `.env` file. A line that is not `NAME=value` is left out.
 *
 * @param {string} file
 * @returns {Map<string, string>}
 */
function readEnvironment(file) {
  /** @type {Map<string, string>} */
  const values = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const value = (match[2] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
    values.set(match[1] ?? '', value);
  }
  return values;
}

/**
 * Builds the plan from the state of now.
 *
 * @param {string[]} also The names that the owner allows to lose work.
 * @returns {{ plan: Plan, main: string, trees: Worktree[] }}
 */
function makePlan(also) {
  const trees = worktrees(process.cwd());
  const main = trees[0]?.path ?? '';
  must('git', ['fetch', '--prune', '--quiet', remote], main);
  const pullRequests = openPullRequestBranches(main);
  const allowed = new Set(also);
  /** @type {Plan} */
  const plan = {
    worktree: [],
    branch: [],
    remoteBranch: [],
    testDatabase: [],
    deployment: [],
    prune: [],
  };

  /** @type {Set<string>} */
  const keptBranches = new Set();
  const mainTree = trees[0];
  if (mainTree?.branch) keptBranches.add(mainTree.branch);
  let keptTrees = 0;
  for (const tree of trees.slice(1)) {
    const label = tree.branch ?? `detached at ${tree.head.slice(0, 7)}`;
    const changed = existsSync(tree.path)
      ? lines(must('git', ['status', '--porcelain'], tree.path)).length
      : 0;
    const ignored = existsSync(tree.path) ? keptIgnoredFiles(tree.path) : [];
    const stranded =
      tree.branch === null && existsSync(tree.path)
        ? commitsOutsideMain('HEAD', tree.path)
        : 0;
    /** @type {string[]} */
    const losses = [];
    if (changed > 0)
      losses.push(
        `${plural(changed, 'file has', 'files have')} changes that are not committed`,
      );
    if (ignored.length > 0)
      losses.push(
        `git ignores ${ignored.slice(0, 3).join(', ')}${ignored.length > 3 ? ` and ${plural(ignored.length - 3, 'more path', 'more paths')}` : ''}, and no build makes ${ignored.length === 1 ? 'it' : 'them'} again`,
      );
    if (stranded > 0)
      losses.push(
        `${plural(stranded, 'commit', 'commits')} on a detached head that ${stranded === 1 ? 'is' : 'are'} not in ${mainBranch}`,
      );
    if (losses.length === 0 || allowed.has(tree.path)) {
      plan.worktree.push({ mark: 'remove', name: tree.path, reason: label });
    } else {
      keptTrees += 1;
      if (tree.branch) keptBranches.add(tree.branch);
      plan.worktree.push({
        mark: 'ask',
        name: tree.path,
        reason: `${label}: ${losses.join(', and ')}`,
      });
    }
  }

  const localBranches = lines(
    must(
      'git',
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
      main,
    ),
  );
  for (const name of localBranches) {
    if (name === mainBranch) continue;
    if (pullRequests.has(name)) {
      plan.branch.push({
        mark: 'keep',
        name,
        reason: 'it has an open pull request',
      });
      continue;
    }
    if (keptBranches.has(name)) {
      plan.branch.push({
        mark: 'keep',
        name,
        reason: 'a kept worktree uses it',
      });
      continue;
    }
    const outside = commitsOutsideMain(name, main);
    if (outside === 0 || allowed.has(name)) {
      plan.branch.push({
        mark: 'delete',
        name,
        reason:
          outside === 0
            ? `every change is in ${mainBranch}`
            : 'the owner allows it',
      });
    } else {
      plan.branch.push({
        mark: 'ask',
        name,
        reason: `${plural(outside, 'commit is', 'commits are')} not in ${mainBranch}`,
      });
    }
  }

  const remoteBranches = lines(
    must(
      'git',
      ['for-each-ref', '--format=%(refname)', `refs/remotes/${remote}`],
      main,
    ),
  )
    .map((reference) => reference.slice(`refs/remotes/${remote}/`.length))
    .filter((name) => name !== 'HEAD' && name !== mainBranch);
  for (const branch of remoteBranches) {
    const name = `${remote}/${branch}`;
    if (pullRequests.has(branch)) {
      plan.remoteBranch.push({
        mark: 'keep',
        name,
        reason: 'it has an open pull request',
      });
      continue;
    }
    const outside = commitsOutsideMain(name, main);
    if (outside === 0 || allowed.has(name)) {
      plan.remoteBranch.push({
        mark: 'delete',
        name,
        reason:
          outside === 0
            ? `every change is in ${mainBranch}`
            : 'the owner allows it',
      });
    } else {
      plan.remoteBranch.push({
        mark: 'ask',
        name,
        reason: `${plural(outside, 'commit is', 'commits are')} not in ${mainBranch}`,
      });
    }
  }

  const docker = dockerAvailable(main);
  if (!docker) {
    const reason = 'Docker does not answer on this machine';
    plan.testDatabase.push({ mark: 'skip', name: testProject, reason });
    plan.deployment.push({ mark: 'skip', name: 'local deployment', reason });
    plan.prune.push({ mark: 'skip', name: 'docker system prune', reason });
    return { plan, main, trees };
  }

  const containers = testContainers(main);
  if (containers.length === 0) {
    plan.testDatabase.push({
      mark: 'skip',
      name: testProject,
      reason: 'no container of the test database exists',
    });
  } else if (keptTrees > 0) {
    plan.testDatabase.push({
      mark: 'keep',
      name: containers.join(', '),
      reason: 'a kept worktree can still use it',
    });
  } else {
    plan.testDatabase.push({
      mark: 'remove',
      name: containers.join(', '),
      reason: 'with its volumes and its network, because no worktree is left',
    });
  }

  const status = run('git', ['status', '--porcelain'], main);
  if (!existsSync(join(main, '.env'))) {
    plan.deployment.push({
      mark: 'skip',
      name: 'local deployment',
      reason: `${main}/.env does not exist`,
    });
  } else if (mainTree?.branch !== mainBranch) {
    plan.deployment.push({
      mark: 'skip',
      name: 'local deployment',
      reason: `the main checkout is not on ${mainBranch}`,
    });
  } else if (status.stdout !== '') {
    plan.deployment.push({
      mark: 'skip',
      name: 'local deployment',
      reason: 'the main checkout has changes that are not committed',
    });
  } else {
    const commit = must('git', ['log', '-1', '--format=%h %s'], main);
    const behind = run(
      'git',
      ['rev-list', '--count', `${mainBranch}..${remote}/${mainBranch}`],
      main,
    ).stdout;
    const note =
      behind !== '' && behind !== '0'
        ? `. ${remote}/${mainBranch} is ${plural(Number(behind), 'commit', 'commits')} ahead, and the deploy does not pull them`
        : '';
    plan.deployment.push({
      mark: 'deploy',
      name: `${mainBranch} at ${commit}`,
      reason: `build the app image and start it again${note}`,
    });
  }

  plan.prune.push({
    mark: 'prune',
    name: 'docker system prune --all --volumes',
    reason:
      'every stopped container, unused image, unused network, build cache and unused anonymous volume',
  });
  return { plan, main, trees };
}

/** @param {Plan} plan */
function printPlan(plan) {
  /** @type {[string, Line[]][]} */
  const sections = [
    ['Worktrees', plan.worktree],
    ['Branches on this machine', plan.branch],
    [`Branches on ${remote}`, plan.remoteBranch],
    ['Test database', plan.testDatabase],
    ['Local deployment', plan.deployment],
    ['Docker', plan.prune],
  ];
  const out = ['Cleanup plan'];
  for (const [title, entries] of sections) {
    out.push('', title);
    if (entries.length === 0) out.push('  (nothing)');
    for (const entry of entries)
      out.push(`  ${entry.mark.padEnd(6)}  ${entry.name}  (${entry.reason})`);
  }
  const asks = Object.values(plan)
    .flat()
    .filter((entry) => entry.mark === 'ask');
  out.push(
    '',
    asks.length === 0
      ? 'No item loses work. apply runs every step above.'
      : `${plural(asks.length, 'item loses', 'items lose')} work and ${asks.length === 1 ? 'stays' : 'stay'} unless apply names ${asks.length === 1 ? 'it' : 'each one'} with --also <name>.`,
  );
  process.stdout.write(`${out.join('\n')}\n`);
}

/**
 * Stops the local application of a checkout when one runs there.
 *
 * @param {string} checkout
 */
function stopApplication(checkout) {
  const stateFile = join(checkout, '.local-app', 'app.json');
  if (!existsSync(stateFile)) return;
  /** @type {unknown} */
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  /** @type {unknown} */
  const pid =
    state !== null && typeof state === 'object'
      ? Reflect.get(state, 'pid')
      : undefined;
  if (typeof pid !== 'number') return;
  try {
    process.kill(pid, 0);
  } catch {
    return;
  }
  if (existsSync(join(checkout, appScript))) {
    must(process.execPath, [appScript, 'stop'], checkout);
  } else {
    process.kill(pid, 'SIGTERM');
  }
  process.stdout.write(`stopped   the application of ${checkout}\n`);
}

/**
 * Reads the ready probe of the deployment through its loopback listener.
 *
 * @param {string} main
 * @returns {Promise<number>}
 */
function readyStatus(main) {
  const environment = readEnvironment(join(main, '.env'));
  const origin = new URL(
    environment.get('NOTESAPP_ORIGIN') ?? 'http://localhost',
  );
  const bindHost = environment.get('NOTESAPP_BIND_HOST') || '127.0.0.1';
  const host = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost;
  const port = Number(environment.get('NOTESAPP_PORT') || '3000');
  return new Promise((done, fail) => {
    // The server answers only the host names of its configured origins, so
    // the probe names that host while it connects to the loopback listener.
    const probe = request(
      {
        host,
        port,
        path: '/ready',
        headers: { host: origin.host },
        timeout: readyTimeoutMs,
      },
      (response) => {
        response.resume();
        done(response.statusCode ?? 0);
      },
    );
    probe.once('timeout', () =>
      probe.destroy(new Error('the ready probe timed out')),
    );
    probe.once('error', fail);
    probe.end();
  });
}

/** @param {string} main */
async function deploy(main) {
  must('docker', ['compose', 'build', 'app'], main);
  must('docker', ['compose', 'up', '--detach', 'app'], main);
  const id = must('docker', ['compose', 'ps', '--quiet', 'app'], main);
  if (id === '') throw new Error('docker compose started no app container.');
  const deadline = Date.now() + healthTimeoutMs;
  let health = '';
  while (Date.now() < deadline) {
    health = must(
      'docker',
      [
        'inspect',
        '--format',
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
        id,
      ],
      main,
    );
    if (health === 'healthy') break;
    await sleep(healthPollMs);
  }
  if (health !== 'healthy') {
    const log = run('docker', ['logs', '--tail', '40', id], main);
    throw new Error(
      `The app container is ${health}, not healthy. Its last log lines:\n${log.stdout}\n${log.stderr}`,
    );
  }
  const status = await readyStatus(main);
  if (status !== 200)
    throw new Error(
      `The app container is healthy, but /ready answers ${status}.`,
    );
  process.stdout.write(
    `deployed  ${must('git', ['log', '-1', '--format=%h %s'], main)}, and /ready answers 200\n`,
  );
}

/** @param {string[]} also */
async function apply(also) {
  const { plan, main, trees } = makePlan(also);
  printPlan(plan);
  process.stdout.write('\nApply\n');
  const removed = plan.worktree
    .filter((entry) => entry.mark === 'remove')
    .map((entry) => entry.name);
  const removeTestDatabase = plan.testDatabase.some(
    (entry) => entry.mark === 'remove',
  );

  for (const path of removed) stopApplication(path);
  if (removeTestDatabase) stopApplication(main);

  for (const path of removed) {
    const allowed = also.includes(path);
    if (existsSync(path))
      must(
        'git',
        [
          'worktree',
          'remove',
          ...(allowed ? ['--force', '--force'] : []),
          path,
        ],
        main,
      );
    process.stdout.write(`removed   ${path}\n`);
  }
  must('git', ['worktree', 'prune'], main);

  for (const entry of plan.branch.filter((line) => line.mark === 'delete')) {
    must('git', ['branch', '-D', entry.name], main);
    process.stdout.write(`deleted   ${entry.name}\n`);
  }

  const remoteNames = plan.remoteBranch
    .filter((line) => line.mark === 'delete')
    .map((line) => line.name.slice(`${remote}/`.length));
  if (remoteNames.length > 0) {
    must('git', ['push', remote, '--delete', ...remoteNames], main);
    for (const name of remoteNames)
      process.stdout.write(`deleted   ${remote}/${name}\n`);
  }
  must('git', ['fetch', '--prune', '--quiet', remote], main);

  if (removeTestDatabase) {
    const label = `label=com.docker.compose.project=${testProject}`;
    const ids = lines(
      must('docker', ['ps', '--all', '--quiet', '--filter', label], main),
    );
    if (ids.length > 0)
      must('docker', ['rm', '--force', '--volumes', ...ids], main);
    const volumes = lines(
      must('docker', ['volume', 'ls', '--quiet', '--filter', label], main),
    );
    if (volumes.length > 0) must('docker', ['volume', 'rm', ...volumes], main);
    const networks = lines(
      must('docker', ['network', 'ls', '--quiet', '--filter', label], main),
    );
    if (networks.length > 0)
      must('docker', ['network', 'rm', ...networks], main);
    process.stdout.write(
      `removed   the test database, its volumes and its network\n`,
    );
  }

  if (plan.deployment.some((entry) => entry.mark === 'deploy'))
    await deploy(main);

  if (plan.prune.some((entry) => entry.mark === 'prune')) {
    const output = must(
      'docker',
      ['system', 'prune', '--all', '--volumes', '--force'],
      main,
    );
    const total =
      lines(output).find((line) => line.startsWith('Total reclaimed space')) ??
      'Total reclaimed space: 0B';
    process.stdout.write(`pruned    Docker. ${total}\n`);
  }

  const out = [
    '',
    'State now',
    '',
    must('git', ['worktree', 'list'], main),
    '',
    must('git', ['branch', '--all'], main),
  ];
  if (dockerAvailable(main))
    out.push(
      '',
      must('docker', ['ps', '--format', '{{.Names}}\t{{.Status}}'], main) ||
        '(no container runs)',
      '',
      must('docker', ['system', 'df'], main),
    );
  const cwd = process.cwd();
  const left = removed.find(
    (path) => cwd === path || cwd.startsWith(`${path}${sep}`),
  );
  if (left !== undefined)
    out.push('', `The shell was in ${left}, which is gone. Change to ${main}.`);
  const unused = also.filter(
    (name) =>
      !trees.some((tree) => tree.path === name) &&
      ![...plan.branch, ...plan.remoteBranch].some(
        (line) => line.name === name,
      ),
  );
  if (unused.length > 0)
    out.push(
      '',
      `No item has the name ${unused.join(', ')}, so --also did nothing for it.`,
    );
  process.stdout.write(`${out.join('\n')}\n`);
}

/** @param {string[]} args @returns {string[]} */
function alsoNames(args) {
  /** @type {string[]} */
  const names = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg !== '--also' || next === undefined || next.startsWith('--'))
      throw new Error(`Unknown argument ${arg ?? ''}. Use --also <name>.`);
    names.push(next);
    index += 1;
  }
  return names;
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'plan' && rest.length === 0) printPlan(makePlan([]).plan);
  else if (command === 'apply') await apply(alsoNames(rest));
  else throw new Error('Use plan, or apply [--also <name>]...');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const after =
    command === 'apply' ? '\nThe steps after this one did not run.' : '';
  process.stderr.write(`${message}${after}\n`);
  process.exitCode = 1;
}
