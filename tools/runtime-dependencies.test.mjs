import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import pnpmfile from '../.pnpmfile.cjs';
import { checkRuntimeDependencies } from './runtime-dependencies.mjs';
import { root } from './workspace.mjs';

/** @typedef {{name: string, version: string, peerDependencies?: Record<string, string>, peerDependenciesMeta?: Record<string, {optional?: boolean}>}} PackageManifest */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is PackageManifest} */
function packageManifest(value) {
  return (
    object(value) &&
    typeof value.name === 'string' &&
    typeof value.version === 'string' &&
    (value.peerDependencies === undefined ||
      (object(value.peerDependencies) &&
        Object.values(value.peerDependencies).every(
          (item) => typeof item === 'string',
        ))) &&
    (value.peerDependenciesMeta === undefined ||
      (object(value.peerDependenciesMeta) &&
        Object.values(value.peerDependenciesMeta).every(
          (item) =>
            object(item) &&
            (item.optional === undefined || typeof item.optional === 'boolean'),
        )))
  );
}

/** @param {string} file @returns {Promise<PackageManifest>} */
async function readManifest(file) {
  /** @type {unknown} */
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (!packageManifest(value))
    throw new Error('The test package manifest is invalid.');
  return value;
}

/** @param {(directory: string) => Promise<void>} action */
async function fixture(action) {
  await mkdir(join(root, '.tooling'), { recursive: true });
  const directory = await mkdtemp(join(root, '.tooling/runtime-graph-'));
  try {
    await manifest(directory, { name: '@notesapp/fixture' });
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** @param {string} directory @param {Record<string, unknown>} value */
async function manifest(directory, value) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify(value));
}

await test('the runtime graph resolves dependencies, aliases and required peers through its virtual store', async () => {
  await fixture(async (directory) => {
    await manifest(directory, {
      name: '@notesapp/fixture',
      dependencies: { consumer: '1.0.0', alias: 'npm:provider@1.0.0' },
    });
    const consumer = join(
      directory,
      'node_modules/.pnpm/consumer@1.0.0/node_modules/consumer',
    );
    const provider = join(
      directory,
      'node_modules/.pnpm/provider@1.0.0/node_modules/provider',
    );
    await manifest(consumer, {
      name: 'consumer',
      peerDependencies: { provider: '1.0.0' },
    });
    await manifest(provider, {
      name: 'provider',
      dependencies: { consumer: '1.0.0' },
    });
    await symlink(consumer, join(directory, 'node_modules/consumer'));
    await symlink(provider, join(directory, 'node_modules/alias'));
    await symlink(provider, join(dirname(consumer), 'provider'));
    await symlink(consumer, join(dirname(provider), 'consumer'));
    assert.deepEqual(await checkRuntimeDependencies(directory), {
      packages: 3,
    });
  });
});

await test('a missing required dependency and a missing required peer stop the runtime graph', async () => {
  for (const group of ['dependencies', 'peerDependencies']) {
    await fixture(async (directory) => {
      await manifest(directory, {
        name: '@notesapp/fixture',
        [group]: { missing: '1.0.0' },
      });
      await assert.rejects(
        checkRuntimeDependencies(directory),
        /unresolved required/,
      );
    });
  }
});

await test('absent optional dependencies and peers are allowed but present ones need complete dependencies', async () => {
  await fixture(async (directory) => {
    await manifest(directory, {
      name: '@notesapp/fixture',
      dependencies: { optional: '1.0.0' },
      optionalDependencies: { optional: '1.0.0' },
      peerDependencies: { peer: '1.0.0' },
      peerDependenciesMeta: { peer: { optional: true } },
    });
    assert.deepEqual(await checkRuntimeDependencies(directory), {
      packages: 1,
    });
    await manifest(join(directory, 'node_modules/optional'), {
      name: 'optional',
      dependencies: { missing: '1.0.0' },
    });
    await assert.rejects(
      checkRuntimeDependencies(directory),
      /optional has an unresolved required dependency: missing/,
    );
    await rm(join(directory, 'node_modules/optional'), { recursive: true });
    await manifest(join(directory, 'node_modules/peer'), {
      name: 'peer',
      peerDependencies: { required: '1.0.0' },
    });
    await assert.rejects(
      checkRuntimeDependencies(directory),
      /peer has an unresolved required peer: required/,
    );
  });
});

await test('the original optional schema-tool graph and a newly required schema tool are refused', async () => {
  for (const group of [
    'optionalDependencies',
    'dependencies',
    'peerDependencies',
  ]) {
    await fixture(async (directory) => {
      await manifest(directory, {
        name: 'better-auth',
        [group]: { 'drizzle-kit': '0.31.10' },
      });
      await manifest(join(directory, 'node_modules/drizzle-kit'), {
        name: 'drizzle-kit',
        version: '0.31.10',
        dependencies: { esbuild: '0.25.12' },
      });
      await assert.rejects(
        checkRuntimeDependencies(directory),
        /excluded runtime tool.*drizzle-kit/,
      );
    });
  }
});

await test('unused schema and compiler entries in the virtual store are refused without a manifest', async () => {
  for (const slot of [
    'drizzle-kit@0.31.10',
    'esbuild@0.25.12',
    '@esbuild+linux-x64@0.25.12',
    '@esbuild-kit+esm-loader@2.6.5',
  ]) {
    await fixture(async (directory) => {
      await mkdir(join(directory, 'node_modules/.pnpm', slot), {
        recursive: true,
      });
      await assert.rejects(
        checkRuntimeDependencies(directory),
        /excluded runtime tool remains/,
      );
    });
  }
});

await test('a renamed directory cannot hide an excluded package and leftover commands are refused', async () => {
  await fixture(async (directory) => {
    await manifest(join(directory, 'node_modules/alias'), {
      name: '@esbuild-kit/core-utils',
    });
    await assert.rejects(
      checkRuntimeDependencies(directory),
      /excluded runtime tool/,
    );
    await rm(join(directory, 'node_modules/alias'), { recursive: true });
    await mkdir(join(directory, 'node_modules/.bin'));
    await writeFile(join(directory, 'node_modules/.bin/esbuild'), 'compiler');
    await assert.rejects(
      checkRuntimeDependencies(directory),
      /excluded runtime tool has a command/,
    );
  });
});

await test('broken optional links and links outside the deployed server are refused', async () => {
  await fixture(async (directory) => {
    await manifest(directory, {
      name: '@notesapp/fixture',
      optionalDependencies: { optional: '1.0.0' },
    });
    await mkdir(join(directory, 'node_modules'));
    const link = join(directory, 'node_modules/optional');
    await symlink(join(directory, 'absent'), link);
    await assert.rejects(checkRuntimeDependencies(directory), /ENOENT/);
    await rm(link);
    await symlink(root, link);
    await assert.rejects(
      checkRuntimeDependencies(directory),
      /leaves the deployed server/,
    );
  });
});

await test('package manifests and dependency names must be valid', async () => {
  await fixture(async (directory) => {
    await manifest(directory, { dependencies: {} });
    await assert.rejects(checkRuntimeDependencies(directory), /has no name/);
    for (const name of ['../outside', '..', '@scope/..']) {
      await manifest(directory, {
        name: 'fixture',
        dependencies: { [name]: '1.0.0' },
      });
      await assert.rejects(
        checkRuntimeDependencies(directory),
        /package name is invalid/,
      );
    }
  });
});

await test('a scope or virtual-store link cannot leave the deployed server', async () => {
  for (const name of ['@scope', '.pnpm', '.bin']) {
    await fixture(async (directory) => {
      await mkdir(join(directory, 'node_modules'));
      await symlink(root, join(directory, 'node_modules', name));
      await assert.rejects(
        checkRuntimeDependencies(directory),
        /leaves the deployed server/,
      );
    });
  }
});

const { hooks } = pnpmfile;

await test('the hook removes both exact optional schema-peer fields and leaves the other fields', async () => {
  const installed = await readManifest(
    join(root, 'apps/server/node_modules/better-auth/package.json'),
  );
  const original = structuredClone(installed);
  const changed = hooks.readPackage(installed);
  const expected = structuredClone(original);
  assert.ok(expected.peerDependencies);
  assert.ok(expected.peerDependenciesMeta);
  delete expected.peerDependencies['drizzle-kit'];
  delete expected.peerDependenciesMeta['drizzle-kit'];
  assert.deepEqual(changed, expected);
  const storage = await readManifest(
    join(root, 'packages/storage-server/package.json'),
  );
  assert.deepEqual(hooks.readPackage(structuredClone(storage)), storage);
  const sharp = await readManifest(
    join(root, 'apps/server/node_modules/sharp/package.json'),
  );
  assert.deepEqual(hooks.readPackage(structuredClone(sharp)), sharp);
});

await test('the hook refuses an unreviewed Better Auth version or changed schema-peer fields', () => {
  const original = {
    name: 'better-auth',
    version: '1.7.6',
    peerDependencies: {
      'drizzle-kit': '>=0.31.4 || >=1.0.0-beta.1',
      pg: '^8.0.0',
    },
    peerDependenciesMeta: {
      'drizzle-kit': { optional: true },
      pg: { optional: true },
    },
  };
  for (const changed of [
    { ...original, version: '1.7.7' },
    { ...original, peerDependencies: { 'drizzle-kit': 'new-range' } },
    {
      ...original,
      peerDependenciesMeta: { 'drizzle-kit': { optional: false } },
    },
    { ...original, peerDependencies: {} },
  ])
    assert.throws(
      () => hooks.readPackage(changed),
      /Review the Better Auth schema peer/,
    );
});

await test('the image recipe copies the hook before installation and retains it in corresponding source', async () => {
  const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
  const copy = dockerfile.indexOf('.pnpmfile.cjs ./');
  assert.ok(
    copy > 0 && copy < dockerfile.indexOf('RUN pnpm install --frozen-lockfile'),
  );
  assert.match(dockerfile, /\.npmrc \.pnpmfile\.cjs \\\n/);
  const check = dockerfile.indexOf(
    'RUN node tools/runtime-dependencies.mjs /prod/server',
  );
  assert.ok(check > dockerfile.indexOf(' deploy --prod '));
  assert.ok(
    check <
      dockerfile.indexOf(
        'RUN node tools/distribution-notices.mjs /prod/server',
      ),
  );
});
