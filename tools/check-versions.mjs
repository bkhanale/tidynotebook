/**
 * Holds the version policy over the manifests and the catalog.
 *
 * A manifest states an exact version, or it states `catalog:` and the catalog
 * of `pnpm-workspace.yaml` states that version once. This check resolves the
 * reference and then applies the same exact version rule to the resolved
 * value, so a range fails wherever a person writes it.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readJson, record, root, workspaces } from './workspace.mjs';

/** A manifest states this, or the catalog states it for the manifest. */
const exact = /^\d+\.\d+\.\d+$/;
/** The catalog that `catalog:` with no name means. */
const defaultCatalog = 'default';

/**
 * Reads the catalogs of `pnpm-workspace.yaml`.
 *
 * The file is a flat map with two space steps, so this reads the two catalog
 * shapes directly and the tools keep their zero dependency rule. `catalog:`
 * becomes the `default` catalog, and each key under `catalogs:` becomes a
 * catalog of that name.
 *
 * @param {string} text
 * @returns {Record<string, Record<string, string>>}
 */
export function parseCatalogs(text) {
  /** @type {Record<string, Record<string, string>>} */
  const catalogs = {};
  /** @type {'none' | 'catalog' | 'catalogs'} */
  let section = 'none';
  let named = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    const body = line.trimStart();
    if (body === '' || body.startsWith('#') || body.startsWith('-')) continue;
    const entry = /^(?:'([^']*)'|"([^"]*)"|([^:]+)):(.*)$/.exec(body);
    if (!entry) continue;
    const key = entry[1] ?? entry[2] ?? (entry[3] ?? '').trim();
    const value = (entry[4] ?? '').trim().replace(/^['"]|['"]$/g, '');
    const indent = line.length - body.length;
    if (indent === 0) {
      if (value !== '') section = 'none';
      else if (key === 'catalog') section = 'catalog';
      else if (key === 'catalogs') section = 'catalogs';
      else section = 'none';
      if (section === 'catalog') catalogs[defaultCatalog] ??= {};
      named = '';
    } else if (section === 'catalog' && indent === 2) {
      (catalogs[defaultCatalog] ??= {})[key] = value;
    } else if (section === 'catalogs' && indent === 2 && value === '') {
      named = key;
      catalogs[named] ??= {};
    } else if (section === 'catalogs' && indent === 4 && named !== '') {
      (catalogs[named] ??= {})[key] = value;
    }
  }
  return catalogs;
}

/**
 * Resolves what a manifest declares to the version that the install uses.
 *
 * A plain specifier resolves to itself. A `catalog:` specifier resolves to the
 * catalog value, and a reference with no entry behind it is a failure, not a
 * pass.
 *
 * @param {string} name
 * @param {string} specifier
 * @param {Record<string, Record<string, string>>} catalogs
 * @returns {{ version: string; error: string }}
 */
export function resolveVersion(name, specifier, catalogs) {
  if (!specifier.startsWith('catalog:'))
    return { version: specifier, error: '' };
  const wanted = specifier.slice('catalog:'.length).trim() || defaultCatalog;
  const catalog = catalogs[wanted];
  if (!catalog)
    return {
      version: '',
      error: `${name} reads the catalog ${wanted}, which pnpm-workspace.yaml does not hold.`,
    };
  const version = catalog[name];
  if (typeof version !== 'string' || version === '')
    return {
      version: '',
      error: `${name} reads the catalog ${wanted}, which has no entry for it.`,
    };
  return { version, error: '' };
}

/**
 * The version policy over one workspace tree, and the manifests it read.
 *
 * @param {string} [directory]
 * @returns {Promise<{ failures: string[]; count: number }>}
 */
export async function versionPolicy(directory = root) {
  const manifest = await readJson(join(directory, 'package.json'));
  const catalogs = parseCatalogs(
    await readFile(join(directory, 'pnpm-workspace.yaml'), 'utf8').catch(
      () => '',
    ),
  );
  const runtime = (
    await readFile(join(directory, '.node-version'), 'utf8').catch(() => '')
  ).trim();
  /** @type {string[]} */
  const failures = [];
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(String(manifest.packageManager)))
    failures.push('Pin a stable pnpm version.');
  // One pinned runtime and one pinned package manager, recorded in both places.
  const engines = record(manifest.engines);
  if (engines.node !== runtime)
    failures.push(
      `engines.node is ${String(engines.node)}; .node-version says ${runtime}.`,
    );
  const pinnedManager = String(manifest.packageManager).split('+')[0] ?? '';
  const expectedManager = pinnedManager.replace(/^pnpm@/, '');
  if (engines.pnpm !== expectedManager)
    failures.push(
      `engines.pnpm is ${String(engines.pnpm)}; packageManager says ${expectedManager}.`,
    );
  const packages = [
    { path: directory, manifest },
    ...(await workspaces(directory)),
  ];
  for (const item of packages) {
    for (const group of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
    ]) {
      for (const [name, declared] of Object.entries(
        record(item.manifest[group]),
      )) {
        const specifier = String(declared);
        if (name.startsWith('@notesapp/')) {
          if (specifier !== 'workspace:*')
            failures.push(
              `${item.path}: ${name} needs an exact stable version (workspace:*).`,
            );
          continue;
        }
        const resolved = resolveVersion(name, specifier, catalogs);
        if (resolved.error !== '') {
          failures.push(`${item.path}: ${resolved.error}`);
          continue;
        }
        if (!exact.test(resolved.version))
          failures.push(`${item.path}: ${name} needs an exact stable version.`);
        // Both TypeScript versions stay named here, so a bump edits this check.
        if (name === 'typescript') {
          const expected =
            item.manifest.name === '@notesapp/sdk-codegen' ? '6.0.3' : '7.0.2';
          if (resolved.version !== expected)
            failures.push(`${item.path}: TypeScript must be ${expected}.`);
        }
      }
    }
    if (item.manifest.name === '@notesapp/sdk-codegen') {
      const declared = String(record(item.manifest.devDependencies).typescript);
      if (resolveVersion('typescript', declared, catalogs).version !== '6.0.3')
        failures.push('SDK code generation must own TypeScript 6.0.3.');
    }
  }
  return { failures, count: packages.length };
}

/**
 * Runs the policy, and adds the checks that read the running process.
 *
 * A fixture tree has no running process behind it, so those two checks run
 * over the repository only.
 *
 * @param {string} directory
 * @returns {Promise<number>}
 */
export async function main(directory) {
  const { failures, count } = await versionPolicy(directory);
  if (directory === resolve(root)) {
    const runtime = (
      await readFile(join(directory, '.node-version'), 'utf8')
    ).trim();
    if (process.versions.node !== runtime)
      failures.unshift(`Use Node ${runtime}; found ${process.versions.node}.`);
    const manager = process.env.npm_config_user_agent;
    const pinned = String(
      (await readJson(join(directory, 'package.json'))).packageManager,
    );
    if (manager && !manager.startsWith(pinned.replace('@', '/') + ' '))
      failures.push(
        'The running package manager does not match packageManager.',
      );
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    return 1;
  }
  console.log(`Version policy passed for ${count} manifest(s).`);
  return 0;
}

// The helpers above stay importable, so the check itself runs only when this
// file is the program.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--root')) {
    console.error('Usage: node tools/check-versions.mjs [--root <directory>]');
    process.exit(1);
  }
  process.exit(await main(resolve(args[1] ?? root)));
}
