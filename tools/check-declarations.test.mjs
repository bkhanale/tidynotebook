import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { missingDeclarations } from './check-declarations.mjs';

// The fixtures below are disposable trees under the system temporary
// directory. They are never committed as application code.
const checker = fileURLToPath(
  new URL('./check-declarations.mjs', import.meta.url),
);

/**
 * A package manifest with the given public entry.
 *
 * @param {string} name
 * @param {unknown} [entry]
 * @returns {string}
 */
function manifest(
  name,
  entry = { types: './dist/index.d.ts', default: './dist/index.js' },
) {
  return JSON.stringify({
    name: `@notesapp/${name}`,
    private: true,
    exports: { '.': entry },
  });
}

/** A built workspace: each public entry has its declaration file. */
const baseline = {
  'packages/core/package.json': manifest('core'),
  'packages/core/dist/index.d.ts': 'export declare const domain: string;\n',
  'apps/web/package.json': manifest('web', {
    types: './dist/app.d.ts',
    default: './dist/app.js',
  }),
  'apps/web/dist/app.d.ts': 'export declare function start(): void;\n',
};

/**
 * Builds the baseline tree with the given changes and runs the body over it. A
 * value of the empty string removes the file.
 *
 * @template T
 * @param {Record<string, string>} overrides
 * @param {(directory: string) => T | Promise<T>} body
 * @returns {Promise<T>}
 */
async function withWorkspace(overrides, body) {
  const directory = mkdtempSync(join(tmpdir(), 'notesapp-declarations-'));
  try {
    for (const [name, content] of Object.entries({
      ...baseline,
      ...overrides,
    })) {
      if (content === '') continue;
      const file = join(directory, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    return await body(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * @param {Record<string, string>} overrides
 * @returns {Promise<{ status: number; output: string }>}
 */
function check(overrides) {
  return withWorkspace(overrides, (directory) => {
    const result = spawnSync(process.execPath, [checker, '--root', directory], {
      encoding: 'utf8',
    });
    return {
      status: result.status ?? 1,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  });
}

await test('a built workspace passes', async () => {
  const result = await check({});
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /every workspace package has its build output/);
});

await test('an absent declaration file fails and asks for the build', async () => {
  const result = await check({ 'packages/core/dist/index.d.ts': '' });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Run `pnpm build` first/);
});

await test('a fresh checkout gives one message for the one cause', async () => {
  const result = await check({
    'packages/core/dist/index.d.ts': '',
    'apps/web/dist/app.d.ts': '',
  });
  assert.equal(result.status, 1, result.output);
  assert.equal(result.output.trim().split('\n').length, 1, result.output);
});

await test('the helper names each package that has no declaration yet', async () => {
  const missing = await withWorkspace(
    { 'packages/core/dist/index.d.ts': '' },
    (directory) => missingDeclarations(directory),
  );
  assert.deepEqual(missing, ['@notesapp/core']);
});

await test('a package with no type entry is skipped', async () => {
  const result = await check({
    'packages/markdown/package.json': manifest('markdown', './src/index.ts'),
    'packages/markdown/src/index.ts': 'export const language = "markdown";\n',
    'packages/sync/package.json': JSON.stringify({
      name: '@notesapp/sync',
      private: true,
    }),
  });
  assert.equal(result.status, 0, result.output);
});
