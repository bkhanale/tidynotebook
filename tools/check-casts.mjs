/**
 * Type assertion check for the JavaScript files.
 *
 * Decision record 0019 allows no type assertion except `as const`. oxlint
 * refuses `as` and the angle bracket form in a TypeScript file, but a
 * JavaScript file that `tsc` checks asserts a type with a JSDoc cast: a block
 * comment with a `@type` tag right before a parenthesized expression. No lint
 * rule reads that form, so this check refuses it in every tracked `.mjs`,
 * `.js` and `.cjs` file. `@type {const}` is the JSDoc form of `as const`, so
 * it passes. A `@type` tag on a declaration is an annotation and not a cast,
 * so it passes too.
 *
 * A separate root permits a disposable negative check without the real tree,
 * in the same shape as `tools/check-docs.mjs`. The tree is a git work tree,
 * because the check reads the files that git tracks or would track.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseSync } from 'oxc-parser';
import { root, trackedFiles } from './workspace.mjs';

/** The extensions of the files that the check reads. */
export const checkedExtensions = ['.mjs', '.js', '.cjs'];

/**
 * The type of the `@type` tag of one block comment, or `null` when it has
 * none. The type may hold braces of its own, such as an object type.
 *
 * @param {string} comment The text inside the comment markers.
 * @returns {string | null}
 */
export function typeTag(comment) {
  const tag = /@type\s*\{/.exec(comment);
  if (tag === null) return null;
  const start = tag.index + tag[0].length;
  let depth = 1;
  for (let index = start; index < comment.length; index += 1) {
    const character = comment[index];
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    if (depth === 0) return comment.slice(start, index).trim();
  }
  return null;
}

/**
 * The JSDoc casts of one source file.
 *
 * The parser gives the comments, so a comment marker inside a string or a
 * template is never read as a comment.
 *
 * @param {string} path The name the parser reads the language from.
 * @param {string} text
 * @returns {{ line: number; type: string }[] | null} `null` when the file
 *   does not parse.
 */
export function jsdocCasts(path, text) {
  const parsed = parseSync(path, text);
  if (parsed.errors.length > 0) return null;
  /** @type {{ line: number; type: string }[]} */
  const casts = [];
  for (const comment of parsed.comments) {
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;
    const type = typeTag(comment.value);
    if (type === null || type === 'const') continue;
    if (!/^\s*\(/.test(text.slice(comment.end))) continue;
    const line = text.slice(0, comment.start).split('\n').length;
    casts.push({ line, type });
  }
  return casts;
}

/**
 * Runs the check over one repository tree.
 *
 * @param {string} directory
 * @returns {Promise<number>} The process status.
 */
export async function main(directory) {
  const files = trackedFiles(directory).filter((file) =>
    checkedExtensions.some((extension) => file.endsWith(extension)),
  );
  /** @type {string[]} */
  const failures = [];
  for (const file of files) {
    const text = await readFile(join(directory, file), 'utf8');
    const casts = jsdocCasts(file, text);
    if (casts === null) {
      failures.push(`${file}: the file does not parse, so no cast is read.`);
      continue;
    }
    for (const cast of casts)
      failures.push(
        `${file}:${String(cast.line)}: a JSDoc cast to ${cast.type}. Record 0019 allows no type assertion except as const. Reach the type through a type guard or a parser that fails loudly, such as record() of tools/workspace.mjs.`,
      );
  }
  if (failures.length > 0) {
    process.stderr.write(
      ['Type assertion check failed:', ...failures.map((f) => `  ${f}`)].join(
        '\n',
      ) + '\n',
    );
    return 1;
  }
  process.stdout.write(
    `Type assertions: ${String(files.length)} JavaScript files hold no JSDoc cast.\n`,
  );
  return 0;
}

// The helpers above are imported by the unit test, so the check itself runs
// only when this file is the program.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--root')) {
    process.stderr.write(
      'Usage: node tools/check-casts.mjs [--root <directory>]\n',
    );
    process.exit(1);
  }
  process.exit(await main(resolve(args[1] ?? root)));
}
