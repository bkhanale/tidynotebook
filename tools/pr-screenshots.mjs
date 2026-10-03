/**
 * Publishes the screenshots of one branch for its pull request.
 *
 * A pull request body shows an image only from an address, and GitHub has no
 * API to upload one. An address that names a branch breaks when the branch is
 * deleted, and a commit that no branch holds can be collected. So the images
 * go to the one branch `pr-screenshots`, which holds no code and only grows:
 * each run adds one commit on top of its tip, with the files under a directory
 * of the run's name. The script prints a Markdown table whose addresses name
 * that commit, so a later run never changes an image of an earlier pull
 * request. Each address is the `blob` address with `?raw=true`, which GitHub
 * also serves to a reader of a private repository.
 *
 * The script builds the commit with a temporary index, so it never touches
 * the working tree, the index, or the branch of the worktree.
 *
 * Usage: `node tools/pr-screenshots.mjs <name> <file.png> [file.png ...]`
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { root } from './workspace.mjs';

/** The branch that holds the screenshots of every pull request. */
export const screenshotBranch = 'pr-screenshots';

/**
 * Refuses a name that is not one lowercase path segment.
 *
 * @param {string} name
 */
export function checkName(name) {
  if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(name))
    throw new Error(
      `The name "${name}" must be lowercase letters, digits, dots and hyphens.`,
    );
  return name;
}

/**
 * Refuses a file that is not a PNG, and two files with one base name.
 *
 * @param {readonly string[]} files
 */
export function checkFiles(files) {
  if (files.length === 0) throw new Error('Give at least one PNG file.');
  const seen = new Set();
  for (const file of files) {
    const name = basename(file);
    if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*\.png$/.test(name))
      throw new Error(
        `The file "${name}" must be a .png with a lowercase hyphenated name.`,
      );
    if (seen.has(name)) throw new Error(`Two files are named "${name}".`);
    seen.add(name);
  }
  return files;
}

/**
 * The owner and the name of a GitHub repository from a remote address.
 *
 * @param {string} url
 */
export function githubRepository(url) {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  if (match === null)
    throw new Error(`The remote "${url}" is not a GitHub repository.`);
  return `${match[1]}/${match[2]}`;
}

/**
 * The scheme of a screenshot from its base name, or null when it has none.
 *
 * @param {string} name
 * @returns {{ stem: string; scheme: 'light' | 'dark' | null }}
 */
export function screenshotScheme(name) {
  const stem = name.replace(/\.png$/, '');
  const match = /^(.*)-(light|dark)$/.exec(stem);
  if (match === null) return { stem, scheme: null };
  return {
    stem: match[1] ?? stem,
    scheme: match[2] === 'light' ? 'light' : 'dark',
  };
}

/**
 * The Markdown table of the screenshots: one row per screen, light on the
 * left and dark on the right.
 *
 * @param {string} repository The owner and the name, `owner/name`.
 * @param {string} commit The commit on the screenshot branch.
 * @param {string} name The directory of this run.
 * @param {readonly string[]} files The base names, in the order to show.
 */
export function screenshotTable(repository, commit, name, files) {
  /** @type {Map<string, { light?: string; dark?: string; other?: string }>} */
  const rows = new Map();
  for (const file of files) {
    const { stem, scheme } = screenshotScheme(file);
    const row = rows.get(stem) ?? {};
    row[scheme ?? 'other'] = file;
    rows.set(stem, row);
  }
  /** @param {string} file @param {string} alt */
  const image = (file, alt) =>
    `![${alt}](https://github.com/${repository}/blob/${commit}/${name}/${file}?raw=true)`;
  const lines = ['| Screen | Light | Dark |', '| --- | --- | --- |'];
  for (const [stem, row] of rows) {
    const title = stem.replaceAll('-', ' ');
    if (row.other !== undefined)
      lines.push(`| ${title} | ${image(row.other, title)} | |`);
    if (row.light === undefined && row.dark === undefined) continue;
    const light =
      row.light === undefined ? '' : image(row.light, `${title}, light`);
    const dark =
      row.dark === undefined ? '' : image(row.dark, `${title}, dark`);
    lines.push(`| ${title} | ${light} | ${dark} |`);
  }
  return lines.join('\n') + '\n';
}

/**
 * @param {string} cwd
 * @param {readonly string[]} args
 * @param {Record<string, string>} [env]
 */
function git(cwd, args, env) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();
}

/**
 * Adds one commit of the files to the screenshot branch and pushes it.
 *
 * @param {string} name
 * @param {readonly string[]} files
 * @param {{ cwd?: string; repository?: string }} [options] The repository
 *   to push from, and the `owner/name` of the addresses when its remote is
 *   not on GitHub.
 */
export function publishScreenshots(name, files, options = {}) {
  checkName(name);
  checkFiles(files);
  const cwd = options.cwd ?? root;
  const repository =
    options.repository ??
    githubRepository(git(cwd, ['remote', 'get-url', 'origin']));
  const remote = git(cwd, [
    'ls-remote',
    'origin',
    `refs/heads/${screenshotBranch}`,
  ]);
  const parent = remote === '' ? null : (remote.split(/\s/)[0] ?? null);
  if (parent !== null)
    git(cwd, ['fetch', '--quiet', 'origin', `refs/heads/${screenshotBranch}`]);
  const directory = mkdtempSync(join(tmpdir(), 'pr-screenshots-'));
  try {
    const env = { GIT_INDEX_FILE: join(directory, 'index') };
    if (parent === null) git(cwd, ['read-tree', '--empty'], env);
    else git(cwd, ['read-tree', parent], env);
    const existing = git(cwd, ['ls-files', '--', `${name}/`], env);
    if (existing !== '')
      throw new Error(
        `The branch ${screenshotBranch} already has a directory "${name}". Choose a new name.`,
      );
    for (const file of files) {
      const blob = git(cwd, ['hash-object', '-w', '--', resolve(file)]);
      git(
        cwd,
        [
          'update-index',
          '--add',
          '--cacheinfo',
          `100644,${blob},${name}/${basename(file)}`,
        ],
        env,
      );
    }
    const tree = git(cwd, ['write-tree'], env);
    const commit = git(cwd, [
      'commit-tree',
      tree,
      ...(parent === null ? [] : ['-p', parent]),
      '-m',
      `chore: screenshots of ${name}`,
    ]);
    git(cwd, [
      'push',
      '--quiet',
      'origin',
      `${commit}:refs/heads/${screenshotBranch}`,
    ]);
    return screenshotTable(
      repository,
      commit,
      name,
      files.map((file) => basename(file)),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// The helpers above stay importable, so the script itself runs only when this
// file is the program.
if (import.meta.main) {
  const [name, ...files] = process.argv.slice(2);
  if (name === undefined) {
    process.stderr.write(
      'Usage: node tools/pr-screenshots.mjs <name> <file.png> [file.png ...]\n',
    );
    process.exit(2);
  }
  try {
    process.stdout.write(publishScreenshots(name, files));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
