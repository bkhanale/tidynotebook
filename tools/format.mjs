/**
 * Runs Prettier over the files of this repository, by name.
 *
 * `prettier --check .` walks the whole tree, and it expands that directory
 * before it applies any ignore file. A local Compose start writes its database
 * under `.data/` as the PostgreSQL service user, so a directory in it is not
 * readable by the person who runs the repository commands, and the walk failed
 * before `.prettierignore` could say anything:
 *
 *     [error] Unable to expand directory: "."
 *     [error] EACCES: permission denied, scandir '<repo>/.data/postgres/18/docker'
 *
 * So the inputs are named instead of walked. The list is what git would track:
 * every file under version control, plus every new file that is not ignored.
 * A directory that `.gitignore` names is therefore never opened, whoever owns
 * it, and a file that a contributor just wrote is still checked.
 *
 * A symbolic link is left out. `.claude/skills/` links to `.agents/skills/`,
 * and Prettier refuses a link that is named explicitly. The file behind it is
 * in the list under its own name.
 *
 * Usage: `node tools/format.mjs --check` or `node tools/format.mjs --write`.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import process from 'node:process';
import { resolve } from 'node:path';
import { root } from './workspace.mjs';

/**
 * The files that git tracks, plus the new ones it would track.
 *
 * @param {string} directory
 * @returns {string[]}
 */
export function trackedFiles(directory) {
  const listed = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: directory, encoding: 'utf8' },
  );
  if (listed.status !== 0)
    throw new Error('notesapp: git could not list the files of this tree.');
  return listed.stdout
    .split('\0')
    .filter((name) => name !== '')
    .filter((name) => {
      // A link and a submodule are not files that Prettier reads.
      const stats = lstatSync(resolve(directory, name), {
        throwIfNoEntry: false,
      });
      return stats !== undefined && stats.isFile();
    });
}

const mode = process.argv[2];
if (mode !== '--check' && mode !== '--write') {
  process.stderr.write('Usage: node tools/format.mjs <--check|--write>\n');
  process.exit(1);
}

const files = trackedFiles(root);
if (files.length === 0) {
  process.stderr.write('notesapp: this tree holds no file to format.\n');
  process.exit(1);
}

// `--ignore-unknown` passes over a file whose kind Prettier does not read, so
// the list can hold every file of the tree without naming the kinds twice.
const run = spawnSync('prettier', [mode, '--ignore-unknown', '--', ...files], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});
process.exit(run.status ?? 1);
