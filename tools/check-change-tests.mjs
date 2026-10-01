/**
 * Change test check.
 *
 * Record 0154 makes a change carry its test. This check reads every file that
 * the branch changes against `main`, the files that are not committed yet
 * among them, and groups the source files by the area that owns them: one
 * workspace package, or the tools of `tools/`. An area whose source changed
 * needs a changed test of that area. A change of `tests/integration/` serves
 * any package, because that tree is the top of the dependency graph, and it
 * serves no tool, because a tool has its own test beside it.
 *
 * A commit of the branch can state why an area has no test, with the trailer
 * `Test-exempt: <area> <reason>`. The check then prints the reason and passes
 * the area. A trailer with no reason exempts nothing.
 *
 * `pnpm lint` runs this check, so `pnpm verify` refuses a branch that fails
 * it. The Stop hook of `.claude/settings.json` runs it with `--hook`, which
 * answers in the form of a Claude Code hook: an agent that ends its turn with
 * untested source goes back to write the test. The hook gives way on the
 * second stop of one turn, so it never traps an agent, and the gate still
 * holds.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './workspace.mjs';

/** The extensions of a file that holds code. */
const codeExtension = /\.(?:ts|tsx|mts|mjs|js)$/;

/** The name of a test file beside its module. */
const testName = /\.test\.(?:ts|tsx|mts|mjs|js)$/;

/** The parts of a path that hold output and not source. */
const outputParts = new Set(['dist', 'generated', 'node_modules', 'coverage']);

/** The directories whose subdirectories are workspace packages. */
const packageParents = ['apps', 'packages'];

/** The one tool directory that is a workspace package of its own. */
const toolPackages = ['tools/sdk-codegen'];

/** The trailer that states why an area has no test. */
export const exemptTrailer = 'Test-exempt';

/**
 * The area that owns a path, or `null` when no rule covers it.
 *
 * A workspace package is its directory, for example `apps/web`. A file under
 * `tools/` that is not inside a tool package belongs to `tools`. A file of
 * `tests/` belongs to `tests`.
 *
 * @param {string} path A repository relative path with `/` separators.
 * @returns {string | null}
 */
export function areaOf(path) {
  const parts = path.split('/');
  if (parts.length >= 3 && packageParents.includes(parts[0] ?? ''))
    return `${parts[0]}/${parts[1]}`;
  for (const name of toolPackages) if (path.startsWith(`${name}/`)) return name;
  if (parts[0] === 'tools' && parts.length >= 2) return 'tools';
  if (parts[0] === 'tests' && parts.length >= 2) return 'tests';
  return null;
}

/**
 * Whether a path is a test, or a support file that only a test reads.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isTest(path) {
  if (!codeExtension.test(path)) return false;
  return testName.test(path) || areaOf(path) === 'tests';
}

/**
 * Whether a path is source that a test must cover.
 *
 * A declaration, generated output and build output are not source. A test is
 * not source either.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isSource(path) {
  if (!codeExtension.test(path) || path.endsWith('.d.ts')) return false;
  if (isTest(path)) return false;
  if (path.split('/').some((part) => outputParts.has(part))) return false;
  const area = areaOf(path);
  return area !== null && area !== 'tests';
}

/**
 * Reads the exemptions that the commit messages of a branch state.
 *
 * @param {string} messages Every commit message of the branch.
 * @returns {{ exempt: Map<string, string>; failures: string[] }}
 */
export function exemptions(messages) {
  /** @type {Map<string, string>} */
  const exempt = new Map();
  /** @type {string[]} */
  const failures = [];
  const pattern = new RegExp(`^${exemptTrailer}:[ \\t]*(.*)$`, 'gim');
  for (const match of messages.matchAll(pattern)) {
    const value = (match[1] ?? '').trim();
    const space = value.search(/\s/);
    const area = space === -1 ? value : value.slice(0, space);
    const reason = space === -1 ? '' : value.slice(space).trim();
    if (area === '' || reason === '') {
      failures.push(
        `"${match[0].trim()}" states no ${area === '' ? 'area' : 'reason'}. Write "${exemptTrailer}: <area> <reason>".`,
      );
      continue;
    }
    exempt.set(area, reason);
  }
  return { exempt, failures };
}

/**
 * The areas whose source changed with no test, and the areas a reason excused.
 *
 * @param {readonly string[]} changed Every changed path of the branch.
 * @param {ReadonlyMap<string, string>} [exempt] The reason of each excused area.
 * @returns {{ untested: { area: string; files: string[] }[]; excused: { area: string; reason: string }[] }}
 */
export function untestedAreas(changed, exempt = new Map()) {
  /** @type {Map<string, string[]>} */
  const sources = new Map();
  /** @type {Set<string>} */
  const tested = new Set();
  let integration = false;
  for (const path of changed) {
    const area = areaOf(path);
    if (area === null) continue;
    if (isTest(path)) {
      if (area === 'tests') integration = true;
      else tested.add(area);
      continue;
    }
    if (!isSource(path)) continue;
    sources.set(area, [...(sources.get(area) ?? []), path]);
  }
  /** @type {{ area: string; files: string[] }[]} */
  const untested = [];
  /** @type {{ area: string; reason: string }[]} */
  const excused = [];
  for (const [area, files] of [...sources].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (tested.has(area)) continue;
    if (integration && area !== 'tools') continue;
    const reason = exempt.get(area);
    if (reason === undefined) untested.push({ area, files: files.sort() });
    else excused.push({ area, reason });
  }
  return { untested, excused };
}

/**
 * Runs one Git command in a directory and answers its output, or `null`.
 *
 * @param {string} directory
 * @param {string[]} args
 * @returns {string | null}
 */
function git(directory, args) {
  try {
    return execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/** @param {string | null} text @returns {string[]} */
const lines = (text) =>
  (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/**
 * Reads the change of a branch: its changed paths and its commit messages.
 *
 * The base is the merge base with `main`, or with `origin/main` when the
 * checkout has no local `main`. The answer is `null` when neither exists.
 *
 * @param {string} directory
 * @returns {{ base: string; changed: string[]; messages: string } | null}
 */
export function readChange(directory) {
  const base = ['main', 'origin/main']
    .map((name) => git(directory, ['merge-base', 'HEAD', name]))
    .find((value) => value !== null)
    ?.trim();
  if (base === undefined || base === '') return null;
  const changed = new Set([
    ...lines(
      git(directory, [
        'diff',
        '--name-only',
        '--no-renames',
        '--diff-filter=ACMR',
        base,
      ]),
    ),
    ...lines(git(directory, ['ls-files', '--others', '--exclude-standard'])),
  ]);
  const messages =
    git(directory, ['log', '--format=%B%n', `${base}..HEAD`]) ?? '';
  return { base, changed: [...changed].sort(), messages };
}

/**
 * The words that send a person or an agent to the missing test.
 *
 * @param {{ area: string; files: string[] }[]} untested
 * @returns {string}
 */
export function untestedMessage(untested) {
  return [
    'These areas changed source and no test (record 0154):',
    ...untested.flatMap(({ area, files }) => [
      `  ${area}`,
      ...files.slice(0, 5).map((file) => `    ${file}`),
      ...(files.length > 5 ? [`    and ${files.length - 5} more`] : []),
    ]),
    'Add or change a test of each area, next to the module or in tests/integration/.',
    `When a change cannot have a test, state why in a commit: "${exemptTrailer}: <area> <reason>".`,
  ].join('\n');
}

/**
 * Runs the check on one checkout and answers its exit status.
 *
 * @param {string} directory
 * @param {{ hook?: boolean; stopHookActive?: boolean }} [options]
 * @returns {number}
 */
export function main(directory, options = {}) {
  const change = readChange(directory);
  if (change === null) {
    if (!options.hook)
      process.stdout.write(
        'Change tests: no main branch to compare with, so nothing is checked.\n',
      );
    return 0;
  }
  const { exempt, failures } = exemptions(change.messages);
  const { untested, excused } = untestedAreas(change.changed, exempt);
  if (options.hook) {
    // A second stop in one turn means the agent already saw the message. It
    // stops, and the gate still refuses the branch.
    if (options.stopHookActive || untested.length === 0) return 0;
    process.stdout.write(
      `${JSON.stringify({ decision: 'block', reason: untestedMessage(untested) })}\n`,
    );
    return 0;
  }
  for (const { area, reason } of excused)
    process.stdout.write(
      `Change tests: ${area} has no test because ${reason}\n`,
    );
  if (untested.length > 0 || failures.length > 0) {
    process.stderr.write(
      [
        'Change test check failed:',
        ...failures.map((failure) => `  ${failure}`),
        ...(untested.length > 0 ? [untestedMessage(untested)] : []),
      ].join('\n') + '\n',
    );
    return 1;
  }
  process.stdout.write(
    `Change tests: ${change.changed.length} changed files since ${change.base.slice(0, 12)}, and every area with changed source changed a test.\n`,
  );
  return 0;
}

/**
 * Reads whether Claude Code already blocked one stop of this turn.
 *
 * The hook input arrives as JSON on standard input. An input that cannot be
 * read counts as a first stop.
 *
 * @returns {boolean}
 */
function stopHookActive() {
  try {
    /** @type {unknown} */
    const input = JSON.parse(readFileSync(0, 'utf8'));
    return Reflect.get(Object(input), 'stop_hook_active') === true;
  } catch {
    return false;
  }
}

// The helpers above are imported by the unit test, so the check itself runs
// only when this file is the program.
if (import.meta.main) {
  const args = process.argv.slice(2);
  const hook = args[0] === '--hook';
  const rest = hook ? args.slice(1) : args;
  if (rest.length && (rest.length !== 2 || rest[0] !== '--root')) {
    process.stderr.write(
      'Usage: node tools/check-change-tests.mjs [--hook] [--root <directory>]\n',
    );
    process.exit(1);
  }
  process.exit(
    main(resolve(rest[1] ?? root), {
      hook,
      stopHookActive: hook ? stopHookActive() : false,
    }),
  );
}
