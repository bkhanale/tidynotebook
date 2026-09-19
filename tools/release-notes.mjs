/**
 * The release notes of one version.
 *
 * `CHANGELOG.md` is the one record of what a release holds, and the GitHub
 * release repeats it. A person who copies the entry by hand drops a line,
 * keeps the heading, or pastes the wrong version, so this script reads the
 * entry and writes the notes. The GitHub release body wraps in the browser,
 * so the notes join each wrapped line back into one line.
 *
 * Usage: `node tools/release-notes.mjs <version>`
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { root } from './workspace.mjs';

/** The headings that a changelog entry may hold, in the order they appear. */
export const entrySections = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
];

/** One entry of the changelog. */
/** @typedef {{ version: string; date: string; body: string }} Entry */

/**
 * Reads every entry of the changelog, newest first.
 *
 * @param {string} text
 * @returns {Entry[]}
 */
export function changelogEntries(text) {
  /** @type {Entry[]} */
  const entries = [];
  /** @type {{ version: string; date: string; lines: string[] } | null} */
  let open = null;
  for (const line of text.split('\n')) {
    const heading = /^## +(\S+)(?: +- +(\S+))?\s*$/.exec(line);
    if (heading !== null) {
      if (open !== null)
        entries.push({
          version: open.version,
          date: open.date,
          body: open.lines.join('\n').trim() + '\n',
        });
      open = { version: heading[1] ?? '', date: heading[2] ?? '', lines: [] };
      continue;
    }
    if (open !== null) open.lines.push(line);
  }
  if (open !== null)
    entries.push({
      version: open.version,
      date: open.date,
      body: open.lines.join('\n').trim() + '\n',
    });
  return entries;
}

/**
 * The entry of one version, or null when the changelog has no such entry.
 *
 * @param {string} text
 * @param {string} version
 * @returns {Entry | null}
 */
export function changelogEntry(text, version) {
  return (
    changelogEntries(text).find((entry) => entry.version === version) ?? null
  );
}

/**
 * Joins each wrapped line of a Markdown body back into one line.
 *
 * A paragraph and a list item each become one line. A heading, a blank line
 * and a fenced block pass through as they are.
 *
 * @param {string} body
 * @returns {string}
 */
export function unwrap(body) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  let open = [];
  let fenced = false;
  const flush = () => {
    if (open.length > 0) lines.push(open.join(' '));
    open = [];
  };
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) {
      flush();
      fenced = !fenced;
      lines.push(line);
      continue;
    }
    if (fenced) {
      lines.push(line);
      continue;
    }
    if (line.trim() === '') {
      flush();
      if (lines.at(-1) !== '') lines.push('');
      continue;
    }
    if (line.startsWith('#')) {
      flush();
      lines.push(line.trim());
      continue;
    }
    if (/^\s*[-*] /.test(line) || open.length === 0) {
      flush();
      open.push(line.trim());
      continue;
    }
    open.push(line.trim());
  }
  flush();
  return lines.join('\n').trim() + '\n';
}

/**
 * The GitHub release body of one version.
 *
 * @param {string} text The whole changelog.
 * @param {string} version
 * @returns {string | null}
 */
export function releaseNotes(text, version) {
  const entry = changelogEntry(text, version);
  return entry === null ? null : unwrap(entry.body);
}

/**
 * @param {string} version
 * @param {string} [directory]
 * @returns {Promise<number>}
 */
export async function main(version, directory = root) {
  const text = await readFile(join(directory, 'CHANGELOG.md'), 'utf8').catch(
    () => null,
  );
  if (text === null) {
    process.stderr.write('CHANGELOG.md: missing.\n');
    return 1;
  }
  const notes = releaseNotes(text, version);
  if (notes === null) {
    const known = changelogEntries(text)
      .slice(0, 5)
      .map((entry) => entry.version)
      .join(', ');
    process.stderr.write(
      `CHANGELOG.md: no entry for ${version}. The newest entries are: ${known}.\n`,
    );
    return 1;
  }
  process.stdout.write(notes);
  return 0;
}

// The helpers above stay importable, so the script itself runs only when this
// file is the program.
if (import.meta.main) {
  const [version] = process.argv.slice(2);
  if (version === undefined) {
    process.stderr.write('Usage: node tools/release-notes.mjs <version>\n');
    process.exit(1);
  }
  process.exit(await main(version));
}
