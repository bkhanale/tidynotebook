import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { jsdocCasts, typeTag } from './check-casts.mjs';

// The fixtures below are disposable trees under the system temporary
// directory. They are never committed as application code. The casts that
// they hold sit inside strings, which the parser never reads as comments, so
// this file passes its own check.
const checker = fileURLToPath(new URL('./check-casts.mjs', import.meta.url));

/** A cast of a value to a string, as a source line. */
const cast = 'const name = /** @type {string} */ (value);\n';

/**
 * Builds a git work tree with the given files and runs the checker over it.
 *
 * @param {Record<string, string>} files
 * @returns {{ status: number; output: string }}
 */
function check(files) {
  const directory = mkdtempSync(join(tmpdir(), 'notesapp-casts-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: directory });
    for (const [name, content] of Object.entries(files)) {
      const file = join(directory, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    const result = spawnSync(process.execPath, [checker, '--root', directory], {
      encoding: 'utf8',
    });
    return {
      status: result.status ?? 1,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

await test('the type tag reader keeps the braces of an object type', () => {
  assert.equal(typeTag('* @type {string} '), 'string');
  assert.equal(
    typeTag('*\n * @type {{ a: { b: string } }}\n '),
    '{ a: { b: string } }',
  );
  assert.equal(typeTag('* @param {string} name '), null);
});

await test('a cast is found on its line, also across two lines', () => {
  assert.deepEqual(jsdocCasts('a.mjs', `const a = 1;\n${cast}`), [
    { line: 2, type: 'string' },
  ]);
  assert.deepEqual(
    jsdocCasts(
      'a.mjs',
      'const b = /** @type {Record<string, unknown>} */ (\n  JSON.parse(text)\n);\n',
    ),
    [{ line: 1, type: 'Record<string, unknown>' }],
  );
});

await test('the as const form, an annotation and a string pass', () => {
  const text = [
    "for (const scheme of /** @type {const} */ (['light', 'dark'])) {}",
    '/** @type {string[]} */',
    'const names = [];',
    "const words = '/** @type {string} */ (value)';",
    'const checked = /** @satisfies {string} */ (value);',
    '',
  ].join('\n');
  assert.deepEqual(jsdocCasts('a.mjs', text), []);
});

await test('a file that does not parse answers null', () => {
  assert.equal(jsdocCasts('a.mjs', 'const = ;\n'), null);
});

await test('a tree with no cast passes', () => {
  const result = check({ 'tools/a.mjs': 'export const a = 1;\n' });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /1 JavaScript files hold no JSDoc cast/);
});

await test('a cast in a tracked file fails and names the file and the line', () => {
  for (const name of ['tools/a.mjs', 'docker/b.js', 'scripts/c.cjs']) {
    const result = check({ [name]: `// A cast.\n${cast}` });
    assert.equal(result.status, 1, name);
    assert.match(
      result.output,
      new RegExp(`${name.replace('.', '\\.')}:2: a JSDoc cast to string`),
    );
  }
});

await test('a file that git ignores is not read', () => {
  const result = check({
    '.gitignore': 'dist/\n',
    'dist/a.mjs': cast,
    'tools/a.mjs': 'export const a = 1;\n',
  });
  assert.equal(result.status, 0, result.output);
});

await test('a file that does not parse fails', () => {
  const result = check({ 'tools/a.mjs': 'const = ;\n' });
  assert.equal(result.status, 1);
  assert.match(result.output, /tools\/a\.mjs: the file does not parse/);
});

await test('this repository holds no JSDoc cast', () => {
  const result = spawnSync(process.execPath, [checker], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
