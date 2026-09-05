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
