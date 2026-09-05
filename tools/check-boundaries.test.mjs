import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The fixtures below are disposable trees under the system temporary
// directory. They are never committed as application code.
const checker = fileURLToPath(
  new URL('./check-boundaries.mjs', import.meta.url),
);

/**
 * @param {string} name
 * @param {Record<string, string>} [dependencies]
 * @param {Record<string, string>} [devDependencies]
 * @returns {string}
 */
function manifest(name, dependencies = {}, devDependencies = {}) {
  return JSON.stringify({
    name: `@notesapp/${name}`,
    private: true,
    exports: { '.': './src/index.ts' },
    scripts: {
      typecheck: 'tsc -p tsconfig.json',
      build: 'tsc -p tsconfig.json',
      'test:unit': 'node ../../tools/run-tests.mjs unit',
    },
    dependencies,
    devDependencies,
  });
}

/**
 * @param {Record<string, string>} files
 * @returns {{ status: number; output: string }}
 */
function check(files) {
  const directory = mkdtempSync(join(tmpdir(), 'notesapp-boundaries-'));
  try {
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

/** @param {Record<string, string>} extra @returns {Record<string, string>} */
const workspace = (extra) => ({
  'packages/core/package.json': manifest('core'),
  'packages/core/src/index.ts': 'export const domain = "core";\n',
  ...extra,
});

/** @param {{ status: number; output: string }} result */
const accepted = (result) => {
  assert.equal(result.status, 0, result.output);
  assert.ok(result.output.includes('Boundary checks passed'), result.output);
};

/** @param {{ status: number; output: string }} result @param {string} reason */
const rejected = (result, reason) => {
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(reason), result.output);
};

test('accepts a browser-safe workspace', () => {
  accepted(
    check(
      workspace({
        'packages/sync/package.json': manifest('sync', {
          '@notesapp/core': 'workspace:*',
        }),
        'packages/sync/src/index.ts':
          "import { domain } from '@notesapp/core';\nexport const queue = domain;\n",
      }),
    ),
  );
});

test('accepts Node test modules in recognized test files', () => {
  accepted(
    check(
      workspace({
        'packages/core/src/domain.test.ts':
          "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { domain } from './index.js';\ntest('domain', () => assert.equal(domain, 'core'));\n",
        'packages/sync/package.json': manifest('sync', {
          '@notesapp/core': 'workspace:*',
        }),
        'packages/sync/src/index.ts': 'export const queue = 1;\n',
        'packages/sync/tests/queue.test.ts':
          "import test from 'node:test';\nimport assert from 'node:assert';\ntest('queue', () => assert.ok(true));\n",
      }),
    ),
  );
});

test('rejects other Node modules in test files', () => {
  rejected(
    check(
      workspace({
        'packages/core/src/domain.test.ts':
          "import { readFile } from 'node:fs/promises';\nexport const read = readFile;\n",
      }),
    ),
    'Browser source cannot import node:fs/promises.',
  );
});

test('rejects a Node built-in module in core', () => {
  rejected(
    check(
      workspace({
        'packages/core/src/index.ts':
          "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n",
      }),
    ),
    'Browser source cannot import node:fs.',
  );
});

test('rejects a bare Node built-in name in a browser package', () => {
  rejected(
    check(
      workspace({
        'packages/ui/package.json': manifest('ui'),
        'packages/ui/src/index.ts':
          "import { join } from 'path';\nexport const path = join;\n",
      }),
    ),
    'Browser source cannot import path.',
  );
});

test('rejects Node reach through a workspace package', () => {
  const result = check(
    workspace({
      'packages/core/src/index.ts':
        "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n",
      'packages/sync/package.json': manifest('sync', {
        '@notesapp/core': 'workspace:*',
      }),
      'packages/sync/src/index.ts':
        "import { read } from '@notesapp/core';\nexport const queue = read;\n",
      'apps/web/package.json': manifest('web', {
        '@notesapp/sync': 'workspace:*',
      }),
      'apps/web/src/index.ts':
        "import { queue } from '@notesapp/sync';\nexport const app = queue;\n",
    }),
  );
  rejected(
    result,
    '@notesapp/web: Browser package reaches Node module node:fs through @notesapp/web -> @notesapp/sync -> @notesapp/core.',
  );
  assert.ok(
    result.output.includes(
      '@notesapp/sync: Browser package reaches Node module node:fs through @notesapp/sync -> @notesapp/core.',
    ),
    result.output,
  );
});

test('rejects a server-only dependency reached by a browser package', () => {
  rejected(
    check(
      workspace({
        'packages/core/package.json': manifest('core', { pg: '8.23.0' }),
      }),
    ),
    'Browser runtime cannot depend on pg.',
  );
});

test('rejects a forbidden core dependency in any group', () => {
  rejected(
    check(
      workspace({
        'packages/core/package.json': manifest('core', {}, { react: '19.2.8' }),
      }),
    ),
    'Core cannot depend on react.',
  );
});

test('rejects import equals require of a Node module', () => {
  rejected(
    check(
      workspace({
        'packages/core/src/index.ts':
          "import fs = require('node:fs');\nexport const read = fs.readFileSync;\n",
      }),
    ),
    'Browser source cannot import node:fs.',
  );
});

test('rejects a deep import through import equals require', () => {
  rejected(
    check(
      workspace({
        'packages/markdown/package.json': manifest('markdown', {
          '@notesapp/core': 'workspace:*',
        }),
        'packages/markdown/src/index.ts':
          "import internal = require('@notesapp/core/src/private.js');\nexport const parse = internal;\n",
      }),
    ),
    'Deep import @notesapp/core/src/private.js is forbidden.',
  );
});

test('rejects a production import of a test file', () => {
  rejected(
    check(
      workspace({
        'packages/core/src/index.ts':
          "export { helper } from './domain.test.js';\n",
        'packages/core/src/domain.test.ts': 'export const helper = 1;\n',
      }),
    ),
    'Production source cannot import test file ./domain.test.js.',
  );
});

test('rejects a deep import', () => {
  rejected(
    check(
      workspace({
        'packages/markdown/package.json': manifest('markdown', {
          '@notesapp/core': 'workspace:*',
        }),
        'packages/markdown/src/index.ts':
          "export { domain } from '@notesapp/core/src/index.js';\n",
      }),
    ),
    'Deep import @notesapp/core/src/index.js is forbidden.',
  );
});

test('rejects a browser import of a Node module', () => {
  rejected(
    check(
      workspace({
        'packages/storage-browser/package.json': manifest('storage-browser'),
        'packages/storage-browser/src/index.ts':
          "import { createHash } from 'node:crypto';\nexport const digest = createHash;\n",
      }),
    ),
    'Browser source cannot import node:crypto.',
  );
});

test('rejects a handwritten fetch call', () => {
  rejected(
    check(
      workspace({
        'apps/web/package.json': manifest('web'),
        'apps/web/src/index.ts':
          "export const load = async () => fetch('/files');\n",
      }),
    ),
    'Handwritten fetch is outside the generated HTTP boundary.',
  );
});

test('rejects computed transport access', () => {
  rejected(
    check(
      workspace({
        'apps/web/package.json': manifest('web'),
        'apps/web/src/index.ts':
          "export const transport = globalThis['fetch'];\n",
      }),
    ),
    'Computed HTTP transport access is forbidden.',
  );
});

test('rejects a relative import that leaves a package', () => {
  rejected(
    check(
      workspace({
        'packages/sync/package.json': manifest('sync'),
        'packages/sync/src/index.ts':
          "export * from '../../core/src/index.js';\n",
      }),
    ),
    'Relative or absolute imports cannot leave a package.',
  );
});

test('rejects a package cycle', () => {
  rejected(
    check(
      workspace({
        'packages/core/package.json': manifest('core', {
          '@notesapp/markdown': 'workspace:*',
        }),
        'packages/markdown/package.json': manifest('markdown', {
          '@notesapp/core': 'workspace:*',
        }),
        'packages/markdown/src/index.ts': 'export const parse = 1;\n',
      }),
    ),
    'Package cycle:',
  );
});

test('rejects a computed dynamic import', () => {
  rejected(
    check(
      workspace({
        'packages/core/src/index.ts':
          'export const load = (name: string) => import(name);\n',
      }),
    ),
    'Dynamic imports must use a literal path.',
  );
});

test('rejects a computed require call', () => {
  rejected(
    check(
      workspace({
        'packages/core/src/index.ts':
          'declare const require: (name: string) => unknown;\nexport const load = (name: string) => require(name);\n',
      }),
    ),
    'require must use a literal module path.',
  );
});
