/**
 * Documentation check.
 *
 * `docs/README.md` states what each documentation directory means and how to
 * write a document of that kind. This check holds the parts of that page that
 * a machine can prove, so the tree cannot drift away from its own index.
 *
 * 1. Every `.md` file under `docs/` sits in a known directory, so a reader and
 *    an agent can tell the kind of a document from its path alone.
 * 2. The code is the source of truth. A fenced block whose language is not a
 *    shell the reader runs is a copy of code, so it is refused. `history/`
 *    holds frozen documents and is exempt from every content rule.
 * 3. Each kind carries its required header: the ADR template for a decision, a
 *    date and a commit for an audit, a status line for a release, and the
 *    "who this is for" sentence for a guide page.
 * 4. Every relative link resolves, so a move cannot leave a dead pointer.
 *
 * A separate root permits a disposable negative check without real documents,
 * in the same shape as `tools/check-agents-md.mjs`.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { root } from './workspace.mjs';

/** The directories that `docs/` may hold, and nothing else. */
export const documentKinds = [
  'guide',
  'development',
  'decisions',
  'releases',
  'audits',
  'plans',
  'history',
];

/** The fenced block languages that a reader runs, plus plain text. */
export const allowedFenceLanguages = [
  '',
  'sh',
  'bash',
  'shell',
  'console',
  'text',
];

/** The headings that `docs/decisions/0000-template.md` states. */
export const decisionHeadings = [
  '## Context',
  '## Decision',
  '## Consequences',
];

/** The sentence that opens every public guide page. */
export const guideAudiencePrefix = 'This page is for';

/** How many opening lines an audit has to name its date and its commit in. */
export const auditHeaderLines = 10;

/** The root files whose relative links are checked with the documents. */
export const linkedRootFiles = ['README.md', 'CONTRIBUTING.md'];

/**
 * Lists every `.md` file under a directory, as repository relative paths.
 *
 * @param {string} directory
 * @param {string} base
 * @returns {Promise<string[]>}
 */
async function listMarkdown(directory, base) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  /** @type {string[]} */
  const found = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await listMarkdown(full, base)));
    else if (entry.name.endsWith('.md'))
      found.push(relative(base, full).split(sep).join('/'));
  }
  return found.sort();
}

/**
 * States why a document path is not a known kind, or `null` when it is.
 *
 * @param {string} path A path relative to `docs/`, with `/` separators.
 * @returns {string | null}
 */
export function placementFailure(path) {
  const parts = path.split('/');
  if (parts.length === 1)
    return parts[0] === 'README.md'
      ? null
      : 'a document sits at the top of docs/. Only README.md belongs there.';
  const [kind, ...rest] = parts;
  if (!documentKinds.includes(/** @type {string} */ (kind)))
    return `"${kind}" is not a documentation directory. Use one of ${documentKinds.join(', ')}.`;
  if (kind === 'audits') {
    if (rest.length !== 2)
      return 'an audit sits in audits/<date>/, one directory deep.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(/** @type {string} */ (rest[0])))
      return `"${rest[0]}" is not an audit date. Name the directory YYYY-MM-DD.`;
    return null;
  }
  if (rest.length !== 1) return `${kind}/ holds no subdirectory.`;
  return null;
}

/**
 * Lists the fenced block languages of one document, in order.
 *
 * @param {string} text
 * @returns {{ language: string; line: number }[]}
 */
export function fenceLanguages(text) {
  /** @type {{ language: string; line: number }[]} */
  const fences = [];
  /** @type {string | null} */
  let open = null;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = /** @type {string} */ (lines[index]);
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    const marker = /** @type {string} */ (match[1]);
    const rest = /** @type {string} */ (match[2]).trim();
    if (open === null) {
      if (marker.startsWith('`') && rest.includes('`')) continue;
      open = marker[0] === '`' ? '`' : '~';
      fences.push({ language: rest.split(/\s+/)[0] ?? '', line: index + 1 });
    } else if (marker[0] === open && rest === '') open = null;
  }
  return fences;
}

/**
 * Lists the link targets of one document that address another file.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function relativeLinks(text) {
  const withoutFences = text.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?\1/gm, '');
  const withoutCode = withoutFences.replace(/`[^`\n]*`/g, '');
  /** @type {string[]} */
  const targets = [];
  for (const match of withoutCode.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = /** @type {string} */ (match[1]);
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith('#')) continue;
    const path = target.split('#')[0];
    if (path) targets.push(path);
  }
  return targets;
}

/**
 * Checks the header that the kind of a document requires.
 *
 * @param {string} kind
 * @param {string} name
 * @param {string} text
 * @returns {string[]}
 */
export function headerFailures(kind, name, text) {
  /** @type {string[]} */
  const failures = [];
  const lines = text.split('\n');
  if (kind !== 'history' && !(lines[0] ?? '').startsWith('# '))
    failures.push('the first line is not a "# " title.');
  const opening = lines.slice(0, auditHeaderLines).join('\n');
  if (kind === 'guide' && !text.includes(guideAudiencePrefix))
    failures.push(
      `no "${guideAudiencePrefix} ..." sentence. A guide page states its reader.`,
    );
  if (kind === 'decisions' && name !== 'README.md') {
    for (const heading of decisionHeadings)
      if (!text.includes(`\n${heading}\n`))
        failures.push(`the ADR template heading "${heading}" is missing.`);
    if (!/^- Status: \S/m.test(text)) failures.push('no "- Status:" line.');
    if (!/^- Date: \S/m.test(text)) failures.push('no "- Date:" line.');
  }
  if (kind === 'audits') {
    if (!/\d{4}-\d{2}-\d{2}/.test(opening))
      failures.push(
        `no date in the first ${auditHeaderLines} lines. An audit names when it was read.`,
      );
    if (!/\b[0-9a-f]{7,40}\b/.test(opening))
      failures.push(
        `no commit in the first ${auditHeaderLines} lines. An audit names what it read.`,
      );
  }
  if (kind === 'releases' && !/^Status: \S/m.test(text))
    failures.push('no "Status:" line.');
  return failures;
}

/**
 * Runs the check over one repository tree.
 *
 * @param {string} directory
 * @returns {Promise<number>} The process status.
 */
export async function main(directory) {
  /** @type {string[]} */
  const failures = [];
  const documents = await listMarkdown(join(directory, 'docs'), directory);
  if (documents.length === 0)
    failures.push('docs/: no document. The documentation tree is missing.');
  /** @type {{ path: string; text: string }[]} */
  const linked = [];
  for (const path of documents) {
    const inside = path.slice('docs/'.length);
    const placement = placementFailure(inside);
    if (placement !== null) {
      failures.push(`${path}: ${placement}`);
      continue;
    }
    const parts = inside.split('/');
    const kind =
      parts.length === 1 ? 'index' : /** @type {string} */ (parts[0]);
    const name = /** @type {string} */ (parts.at(-1));
    const text = await readFile(join(directory, path), 'utf8');
    linked.push({ path, text });
    if (kind === 'history') continue;
    for (const failure of headerFailures(kind, name, text))
      failures.push(`${path}: ${failure}`);
    for (const fence of fenceLanguages(text))
      if (!allowedFenceLanguages.includes(fence.language))
        failures.push(
          `${path}:${fence.line}: a "${fence.language}" block. A document points at code and never copies it.`,
        );
  }
  for (const name of linkedRootFiles) {
    const text = await readFile(join(directory, name), 'utf8').catch(
      () => null,
    );
    if (text === null) failures.push(`${name}: missing.`);
    else linked.push({ path: name, text });
  }
  for (const { path, text } of linked)
    for (const target of relativeLinks(text)) {
      const resolved = resolve(directory, dirname(path), target);
      const found = await stat(resolved).then(
        () => true,
        () => false,
      );
      if (!found)
        failures.push(`${path}: the link "${target}" resolves to no file.`);
    }
  if (failures.length > 0) {
    console.error('Documentation check failed:');
    for (const failure of failures) console.error(`  ${failure}`);
    console.error('  See docs/README.md for the rule behind each message.');
    return 1;
  }
  console.log(
    `Documents: ${documents.length} files under docs/ sit in ${documentKinds.length} known directories, with every header and every relative link in place.`,
  );
  return 0;
}

// The helpers above are imported by the unit test, so the check itself runs
// only when this file is the program.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--root')) {
    console.error('Usage: node tools/check-docs.mjs [--root <directory>]');
    process.exit(1);
  }
  process.exit(await main(resolve(args[1] ?? root)));
}
