import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  baseImages,
  contextImportFailures,
  imageFailures,
  installCopyFailures,
  outsideContext,
  dependencyFolderFailures,
  parseCatalogs,
  patchFiles,
  resolveVersion,
  versionPolicy,
} from './check-versions.mjs';

// The fixtures below are disposable trees under the system temporary
// directory. They are never committed as application code.
const checker = fileURLToPath(new URL('./check-versions.mjs', import.meta.url));

/** The two TypeScript versions that the check names itself. */
const toolchainTypeScript = '7.0.2';
const codegenTypeScript = '6.0.3';

/**
 * A workspace manifest with the given declared versions.
 *
 * @param {string} name
 * @param {Record<string, string>} devDependencies
 * @returns {string}
 */
function manifest(name, devDependencies) {
  return JSON.stringify({
    name: `@notesapp/${name}`,
    private: true,
    devDependencies,
  });
}

/**
 * A workspace file that holds the default catalog and the named ones.
 *
 * @param {string[]} lines
 * @returns {string}
 */
function workspaceFile(lines) {
  return [
    'packages:',
    '  - packages/*',
    '  - tools/sdk-codegen',
    ...lines,
  ].join('\n');
}

/** A digest of the right shape. */
const digest = `sha256:${'a'.repeat(64)}`;
/** The one base image of the fixture, at the release of `.node-version`. */
const image = `node:2.3.4-bookworm-slim@${digest}`;

/** The lines that copy each manifest of the fixture before the install. */
const manifestCopies = [
  'COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./',
  'COPY packages/core/package.json ./packages/core/',
  'COPY packages/storage-server/package.json ./packages/storage-server/',
  'COPY tools/sdk-codegen/package.json ./tools/sdk-codegen/',
];

/**
 * A Dockerfile of two stages over the given base images.
 *
 * @param {string} build
 * @param {string} [run]
 * @returns {string}
 */
function dockerfile(build, run = build) {
  return [
    `FROM ${build} AS base`,
    'FROM base AS builder',
    ...manifestCopies,
    'RUN pnpm install --frozen-lockfile',
    'RUN pnpm build',
    `FROM ${run} AS runner`,
    'COPY --from=builder /app /app',
  ].join('\n');
}

/**
 * The root manifest, with the image that the service measurement runs.
 *
 * @param {string} serviceImage
 * @returns {string}
 */
function rootManifest(serviceImage) {
  return JSON.stringify({
    name: 'fixture',
    private: true,
    packageManager: 'pnpm@1.2.3',
    engines: { node: '2.3.4', pnpm: '1.2.3' },
    scripts: { 'perf:service': `docker run --rm ${serviceImage} node x.ts` },
    devDependencies: {
      '@types/node': 'catalog:',
      typescript: 'catalog:toolchain',
    },
  });
}

/** A passing workspace: every shared version sits once, in a catalog. */
const baseline = {
  '.dockerignore': '**/node_modules\n',
  '.node-version': '2.3.4\n',
  Dockerfile: dockerfile(image),
  'package.json': rootManifest(image),
  'pnpm-workspace.yaml': workspaceFile([
    '# A comment above the catalog is skipped.',
    'catalog:',
    "  '@types/node': 26.4.1",
    '  pg: 8.23.0',
    'catalogs:',
    '  toolchain:',
    `    typescript: ${toolchainTypeScript}`,
    '  codegen:',
    `    typescript: ${codegenTypeScript}`,
  ]),
  'packages/core/package.json': manifest('core', {
    '@types/node': 'catalog:',
    typescript: 'catalog:toolchain',
  }),
  'packages/storage-server/package.json': manifest('storage-server', {
    pg: 'catalog:',
    typescript: 'catalog:toolchain',
  }),
  'tools/sdk-codegen/package.json': manifest('sdk-codegen', {
    '@types/node': 'catalog:',
    typescript: 'catalog:codegen',
  }),
};

/**
 * Builds the baseline tree with the given changes and runs the checker over
 * it. A value of the empty string removes the file.
 *
 * @param {Record<string, string>} overrides
 * @returns {{ status: number; output: string }}
 */
function check(overrides) {
  const directory = mkdtempSync(join(tmpdir(), 'notesapp-versions-'));
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

await test('a catalog entry that holds an exact version passes', () => {
  const result = check({});
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Version policy passed for 4 manifest\(s\)/);
});

await test('a range in the catalog is refused', () => {
  const result = check({
    'pnpm-workspace.yaml': workspaceFile([
      'catalog:',
      "  '@types/node': ^26.4.1",
      '  pg: 8.23.0',
      'catalogs:',
      '  toolchain:',
      `    typescript: ${toolchainTypeScript}`,
      '  codegen:',
      `    typescript: ${codegenTypeScript}`,
    ]),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /@types\/node needs an exact stable version/);
});

await test('a range in a manifest is still refused', () => {
  const result = check({
    'packages/core/package.json': manifest('core', {
      '@types/node': '>=26.0.0',
      typescript: 'catalog:toolchain',
    }),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /@types\/node needs an exact stable version/);
});

await test('a catalog reference with no entry behind it is refused', () => {
  const result = check({
    'packages/core/package.json': manifest('core', {
      '@types/node': 'catalog:',
      katex: 'catalog:',
      typescript: 'catalog:toolchain',
    }),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /katex reads the catalog default/);
  assert.match(result.output, /has no entry for it/);
});

await test('a reference to a catalog that does not exist is refused', () => {
  const result = check({
    'packages/core/package.json': manifest('core', {
      '@types/node': 'catalog:',
      typescript: 'catalog:compiler',
    }),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /pnpm-workspace\.yaml does not hold/);
});

await test('a workspace with no catalog at all refuses every reference', () => {
  const result = check({ 'pnpm-workspace.yaml': workspaceFile([]) });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /pnpm-workspace\.yaml does not hold/);
});

await test('the code generator keeps its own compiler through the catalog', () => {
  const result = check({
    'tools/sdk-codegen/package.json': manifest('sdk-codegen', {
      typescript: 'catalog:toolchain',
    }),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /TypeScript must be 6\.0\.3/);
  assert.match(result.output, /SDK code generation must own TypeScript/);
});

await test('a workspace link still needs the workspace protocol', () => {
  const result = check({
    'packages/core/package.json': JSON.stringify({
      name: '@notesapp/core',
      private: true,
      dependencies: { '@notesapp/markdown': 'catalog:' },
      devDependencies: { typescript: 'catalog:toolchain' },
    }),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /needs an exact stable version \(workspace:\*\)/);
});

await test('the reader takes the default catalog and each named one', () => {
  const catalogs = parseCatalogs(
    [
      'packages:',
      '  - packages/*',
      'catalog:',
      "  '@types/node': 26.4.1 # the shared type declarations",
      'catalogs:',
      '  toolchain:',
      '    typescript: 7.0.2',
    ].join('\n'),
  );
  assert.deepEqual(catalogs, {
    default: { '@types/node': '26.4.1' },
    toolchain: { typescript: '7.0.2' },
  });
});

await test('a plain version resolves to itself', () => {
  const resolved = resolveVersion('pg', '8.23.0', {});
  assert.deepEqual(resolved, { version: '8.23.0', error: '' });
});

await test('a base image on another Node release is refused', () => {
  const other = `node:2.3.9-bookworm-slim@${digest}`;
  const result = check({
    Dockerfile: dockerfile(other),
    'package.json': rootManifest(other),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /Dockerfile runs node:2\.3\.9-bookworm-slim; \.node-version says 2\.3\.4/,
  );
});

await test('a floating tag is refused even when its digest holds the release', () => {
  const floating = `node:2-bookworm-slim@${digest}`;
  const result = check({
    Dockerfile: dockerfile(floating),
    'package.json': rootManifest(floating),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Dockerfile runs node:2-bookworm-slim/);
});

await test('a base image with no digest is refused', () => {
  const tagOnly = 'node:2.3.4-bookworm-slim';
  const result = check({
    Dockerfile: dockerfile(tagOnly),
    'package.json': rootManifest(tagOnly),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /pin a node tag and its digest/);
});

await test('two stages on two base images are refused', () => {
  const result = check({
    Dockerfile: dockerfile(image, `node:2.3.4-bookworm@${digest}`),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /stages of Dockerfile name different base images/,
  );
});

await test('a service measurement on another image is refused', () => {
  const result = check({
    'package.json': rootManifest(
      `node:2.3.4-bookworm-slim@sha256:${'b'.repeat(64)}`,
    ),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /perf:service script does not run node:2\.3\.4/);
});

await test('a tree with no Dockerfile is refused', () => {
  const result = check({ Dockerfile: '' });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Dockerfile names no base image/);
});

await test('the image reader skips a stage name and a platform flag', () => {
  assert.deepEqual(
    baseImages(
      [
        `FROM --platform=linux/amd64 ${image} AS base`,
        'FROM base AS builder',
        `from ${image}`,
      ].join('\n'),
    ),
    [image, image],
  );
});

await test('an exact tag with no variant passes', () => {
  const plain = `node:2.3.4@${digest}`;
  assert.deepEqual(
    imageFailures(dockerfile(plain), `docker run ${plain} node`, '2.3.4'),
    [],
  );
});

await test('the patch files of the workspace are read', () => {
  assert.deepEqual(
    patchFiles(
      [
        'packages:',
        '  - apps/*',
        'patchedDependencies:',
        "  '@lezer/markdown@1.7.2': patches/@lezer__markdown@1.7.2.patch",
        '  mdast-util-to-hast@13.2.1: patches/mdast-util-to-hast@13.2.1.patch',
        'catalog:',
        '  a: 1.0.0',
      ].join('\n'),
    ),
    [
      'patches/@lezer__markdown@1.7.2.patch',
      'patches/mdast-util-to-hast@13.2.1.patch',
    ],
  );
});

// Regression: the image of 0.13.0 did not build, because the Dockerfile ran
// pnpm install before it copied the patches folder.
await test('a Dockerfile that installs before it copies a patch is refused', () => {
  const patch = 'patches/a@1.0.0.patch';
  const before = [
    'COPY package.json pnpm-lock.yaml ./',
    'RUN pnpm install --frozen-lockfile',
    'COPY patches ./patches',
  ].join('\n');
  assert.deepEqual(installCopyFailures(before, [patch]), [
    `Dockerfile installs before it copies ${patch}; copy it before pnpm install.`,
  ]);
  const after = [
    'COPY package.json pnpm-lock.yaml ./',
    'COPY patches ./patches',
    'RUN pnpm install --frozen-lockfile',
  ].join('\n');
  assert.deepEqual(installCopyFailures(after, [patch]), []);
  assert.deepEqual(installCopyFailures(before, []), []);
});

await test('the build context follows the rules of .dockerignore', () => {
  const ignore = [
    '# a comment',
    'apps/docs',
    '**/dist',
    'tools/*.test.mjs',
    'docs',
    '!docs/keep.md',
  ].join('\n');
  assert.equal(outsideContext(ignore, 'apps/docs/src/site.ts'), true);
  assert.equal(outsideContext(ignore, 'apps/web/src/main.ts'), false);
  assert.equal(outsideContext(ignore, 'packages/ui/dist/index.js'), true);
  assert.equal(outsideContext(ignore, 'tools/a.test.mjs'), true);
  assert.equal(outsideContext(ignore, 'tools/a.mjs'), false);
  assert.equal(outsideContext(ignore, 'docs/other.md'), true);
  assert.equal(outsideContext(ignore, 'docs/keep.md'), false);
});

// Regression: the tag of 0.14.0 has no image. The root tsc of the image build
// read a tool test that imports the docs site, which the context leaves out.
await test('a type-checked file that imports outside the build context is refused', () => {
  const file = {
    path: 'tools/product-name.test.mjs',
    text: [
      "import { productName } from '../packages/core/src/product.ts';",
      "import { productName as docs } from '../apps/docs/src/site.ts';",
      "const later = await import('../tests/fixture.mjs');",
    ].join('\n'),
  };
  assert.deepEqual(contextImportFailures('apps/docs\ntests', [file]), [
    'tools/product-name.test.mjs imports apps/docs/src/site.ts, which .dockerignore keeps out of the image build.',
    'tools/product-name.test.mjs imports tests/fixture.mjs, which .dockerignore keeps out of the image build.',
  ]);
  assert.deepEqual(
    contextImportFailures('apps/docs\ntests\ntools/*.test.mjs', [file]),
    [],
  );
});

await test('the checker refuses a tree whose image build cannot read an import', () => {
  const result = check({
    '.dockerignore': '**/node_modules\napps/docs\n',
    'tsconfig.json': JSON.stringify({ include: ['tools/*.mjs'] }),
    'tools/a.mjs': "import { name } from '../apps/docs/src/site.ts';\n",
  });
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /tools\/a\.mjs imports apps\/docs\/src\/site\.ts/,
  );
});

// Regression: the Dockerfile did not copy the manifests of packages/logging
// and packages/note-document before pnpm install, so the frozen install could
// not compare them with the lockfile, and a manifest that drifted from the
// lockfile still built an image.
await test('a Dockerfile that installs before it copies a manifest is refused', () => {
  const result = check({
    Dockerfile: dockerfile(image).replace(
      'COPY packages/storage-server/package.json ./packages/storage-server/\n',
      '',
    ),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /Dockerfile installs before it copies packages\/storage-server\/package\.json/,
  );
});

await test('a manifest that the build context leaves out needs no copy', () => {
  const result = check({
    '.dockerignore': '**/node_modules\napps/docs\n',
    'apps/docs/package.json': manifest('docs', {
      typescript: 'catalog:toolchain',
    }),
  });
  assert.equal(result.status, 0, result.output);
});

await test('a manifest that the build context keeps needs a copy', () => {
  const result = check({
    'apps/web/package.json': manifest('web', {
      typescript: 'catalog:toolchain',
    }),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /copies apps\/web\/package\.json/);
});

await test('the Dockerfile of this repository copies each manifest before the install', async () => {
  const { failures } = await versionPolicy();
  assert.deepEqual(
    failures.filter((failure) => failure.includes('installs before')),
    [],
  );
});

await test('a dependency folder of a workspace member stays out of the image build', () => {
  const members = ['apps/web', 'packages/ui'];
  assert.deepEqual(dependencyFolderFailures('**/node_modules\n', members), []);
  assert.deepEqual(dependencyFolderFailures('node_modules\n', members), [
    '.dockerignore keeps apps/web/node_modules in the image build; ignore **/node_modules.',
    '.dockerignore keeps packages/ui/node_modules in the image build; ignore **/node_modules.',
  ]);
  assert.equal(dependencyFolderFailures('', []).length, 1);
});
