import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set([
  'node_modules',
  '.git',
  '.tooling',
  'dist',
  'coverage',
]);

/** @param {unknown} value @returns {Record<string, unknown>} */
export function record(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return {};
  return Object.fromEntries(Object.entries(value));
}

/** @param {string} file */
export async function readJson(file) {
  return record(JSON.parse(await readFile(file, 'utf8')));
}

/** @param {string} directory @returns {Promise<string[]>} */
export async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error) => {
      if (record(error).code === 'ENOENT') return [];
      throw error;
    },
  );
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) return [];
      const file = join(directory, entry.name);
      return entry.isDirectory() ? filesIn(file) : [file];
    }),
  );
  return files.flat().sort();
}

/**
 * The files that git tracks, plus the new ones it would track.
 *
 * A directory that `.gitignore` names is never opened, whoever owns it, and a
 * file that a contributor just wrote is still listed. A symbolic link and a
 * submodule are left out: `.claude/skills/` links to `.agents/skills/`, and
 * the file behind the link is in the list under its own name.
 *
 * @param {string} directory
 * @returns {string[]} Paths relative to the directory.
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
      const stats = lstatSync(resolve(directory, name), {
        throwIfNoEntry: false,
      });
      return stats !== undefined && stats.isFile();
    });
}

/** @param {string} [directory] */
export async function workspaces(directory = root) {
  const manifests = [];
  for (const folder of ['apps', 'packages', 'tools']) {
    const parent = resolve(directory, folder);
    const entries = await readdir(parent, { withFileTypes: true }).catch(
      (error) => {
        if (record(error).code === 'ENOENT') return [];
        throw error;
      },
    );
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        (folder === 'tools' && entry.name !== 'sdk-codegen')
      )
        continue;
      const path = join(parent, entry.name);
      manifests.push({
        path,
        manifest: await readJson(join(path, 'package.json')),
      });
    }
  }
  return manifests;
}
