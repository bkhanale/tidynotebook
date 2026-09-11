/**
 * Agent reading list.
 *
 * Several agent harnesses work on this repository, and each one holds its
 * context in its own file format. No harness feature can carry the rule that
 * an agent reads the context first, so this script is the portable form: the
 * core list for every change, then the nested `AGENTS.md` that owns each
 * given path, then the `Key files` rows of that guide. The status is non-zero
 * when a listed file is gone, so `tools/check-agents-md.mjs` runs the list
 * for every guide and fails on a stale pointer.
 */
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { filesIn, root } from './workspace.mjs';

/** The files an agent reads before any change. @type {[string, string][]} */
export const coreReadingList = [
  ['AGENTS.md', 'Every rule of this repository.'],
  ['docs/README.md', 'Where a document belongs.'],
  ['docs/development/feature-workflow.md', 'The order of one whole feature.'],
  ['docs/decisions/README.md', 'The decisions and when one is needed.'],
  ['docs/releases/0.1.0.md', 'The one prioritized list of open work.'],
];

/** @param {string} file @returns {Promise<boolean>} */
async function exists(file) {
  return (await stat(file).catch(() => null)) !== null;
}

/**
 * Reads the `Key files` table. A path is relative to the guide.
 *
 * @param {string} text @returns {{ path: string; purpose: string }[]}
 */
export function keyFiles(text) {
  /** @type {{ path: string; purpose: string }[]} */
  const rows = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) {
      inside = /^#+\s+key files\s*$/i.test(line);
      continue;
    }
    if (!inside || !line.trimStart().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1);
    const name = /^\s*`([^`]+)`\s*$/.exec(cells[0] ?? '');
    if (!name) continue;
    rows.push({ path: name[1] ?? '', purpose: (cells[1] ?? '').trim() });
  }
  return rows;
}

/**
 * The nested guide that owns a path, relative to the tree.
 *
 * @param {string} directory @param {string} target @returns {Promise<string?>}
 */
export async function nearestGuide(directory, target) {
  const top = resolve(directory);
  const absolute = resolve(top, target);
  const stats = await stat(absolute).catch(() => null);
  let current = stats?.isDirectory() ? absolute : dirname(absolute);
  while (current.startsWith(top + sep)) {
    const guide = join(current, 'AGENTS.md');
    if (await exists(guide)) return relative(top, guide);
    current = dirname(current);
  }
  return null;
}

/** Every nested guide of a tree. @param {string} directory */
export async function nestedGuides(directory) {
  const top = resolve(directory);
  const files = await filesIn(top);
  return files
    .filter((file) => file.endsWith(`${sep}AGENTS.md`) && dirname(file) !== top)
    .map((file) => relative(top, file));
}

/**
 * The ordered reading list. No path means every nested guide of the tree.
 *
 * @param {string} directory @param {string[]} paths
 * @returns {Promise<{ file: string; purpose: string }[]>}
 */
export async function readingList(directory, paths) {
  const guides = paths.length === 0 ? await nestedGuides(directory) : [];
  for (const path of paths) {
    const guide = await nearestGuide(directory, path);
    if (guide) guides.push(guide);
  }
  /** @type {Map<string, string>} */
  const list = new Map();
  for (const [file, purpose] of coreReadingList) list.set(file, purpose);
  for (const guide of guides) {
    const owner = dirname(guide);
    if (list.has(guide)) continue;
    list.set(guide, `The rules of ${owner}/.`);
    const text = await readFile(resolve(directory, guide), 'utf8');
    for (const row of keyFiles(text)) {
      const file = join(owner, row.path);
      if (!list.has(file)) list.set(file, row.purpose);
    }
  }
  return [...list].map(([file, purpose]) => ({ file, purpose }));
}

/**
 * The listed files that are not there.
 *
 * @param {string} directory @param {{ file: string }[]} entries
 */
export async function missingFiles(directory, entries) {
  const checked = await Promise.all(
    entries.map(async (entry) =>
      (await exists(resolve(directory, entry.file))) ? '' : entry.file,
    ),
  );
  return checked.filter((file) => file !== '');
}

/**
 * Prints the list for one tree, and returns the process status.
 *
 * @param {string} directory @param {string[]} paths @returns {Promise<number>}
 */
export async function main(directory, paths) {
  const entries = await readingList(directory, paths);
  console.log('Read these files in order before you edit:');
  for (const [index, entry] of entries.entries())
    console.log(`  ${index + 1}. ${entry.file}: ${entry.purpose}`);
  const missing = await missingFiles(directory, entries);
  if (missing.length > 0) {
    console.error('Missing files. A guide points at a file that is not there:');
    for (const file of missing) console.error(`  ${file}`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const rooted = args[0] === '--root';
  if (rooted && args.length < 2) {
    console.error('Usage: node tools/agent-context.mjs [path ...]');
    process.exit(1);
  }
  const directory = resolve(rooted ? (args[1] ?? root) : root);
  process.exit(await main(directory, args.slice(rooted ? 2 : 0)));
}
