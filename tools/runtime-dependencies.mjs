/** Check the installed runtime graph without changing its files. */
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The runtime package manifest is invalid.');
  return Object.fromEntries(Object.entries(value));
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function group(value) {
  return value === undefined ? {} : object(value);
}

/** @param {string} name */
function packageName(name) {
  if (
    !/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name) ||
    name.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error(`The runtime package name is invalid: ${name}.`);
  return name;
}

/** @param {string} name */
function excluded(name) {
  return (
    name === 'drizzle-kit' ||
    name === 'esbuild' ||
    name.startsWith('@esbuild/') ||
    name.startsWith('@esbuild-kit/')
  );
}

/** @param {string} entry @returns {Promise<{packages: number}>} */
export async function checkRuntimeDependencies(entry) {
  const root = await realpath(entry);
  /** @type {Map<string, {name: string, manifest: Record<string, unknown>}>} */
  const packages = new Map();
  /** @type {Set<string>} */
  const modules = new Set();

  /** @param {string} path */
  function inside(path) {
    const local = relative(root, path);
    if (
      local === '..' ||
      local.startsWith('..' + sep) ||
      resolve(root, local) !== path
    )
      throw new Error(`A runtime package leaves the deployed server: ${path}.`);
    return path;
  }

  /** @param {string} path */
  async function present(path) {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (object(error).code === 'ENOENT') return false;
      throw error;
    }
  }

  /** @param {string} path */
  async function visit(path) {
    path = inside(await realpath(path));
    if (packages.has(path)) return;
    const manifest = object(
      JSON.parse(await readFile(join(path, 'package.json'), 'utf8')),
    );
    if (typeof manifest.name !== 'string')
      throw new Error('A runtime package has no name.');
    const name = packageName(manifest.name);
    if (excluded(name))
      throw new Error(`An excluded runtime tool is installed: ${name}.`);
    packages.set(path, { name, manifest });
    await scan(join(path, 'node_modules'));
  }

  /** @param {string} directory */
  async function scan(directory) {
    if (!(await present(directory))) return;
    directory = inside(await realpath(directory));
    if (modules.has(directory)) return;
    modules.add(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.name === '.pnpm') {
        inside(await realpath(path));
        for (const slot of await readdir(path, { withFileTypes: true })) {
          if (!slot.isDirectory()) continue;
          if (
            /^(?:drizzle-kit|esbuild|@esbuild\+[^@]+|@esbuild-kit\+[^@]+)@/.test(
              slot.name,
            )
          )
            throw new Error(
              `An excluded runtime tool remains in the virtual store: ${slot.name}.`,
            );
          await scan(
            slot.name === 'node_modules'
              ? join(path, slot.name)
              : join(path, slot.name, 'node_modules'),
          );
        }
      } else if (entry.name === '.bin') {
        inside(await realpath(path));
        for (const bin of await readdir(path))
          if (/^(?:esbuild|drizzle-kit)(?:\.|$)/.test(bin))
            throw new Error(`An excluded runtime tool has a command: ${bin}.`);
      } else if (entry.name.startsWith('@')) {
        inside(await realpath(path));
        for (const item of await readdir(path)) await visit(join(path, item));
      } else if (
        !entry.name.startsWith('.') &&
        (entry.isDirectory() || entry.isSymbolicLink())
      ) {
        await visit(path);
      }
    }
  }

  /** @param {string} name @param {string} from */
  async function dependency(name, from) {
    packageName(name);
    for (let directory = from; ; directory = dirname(directory)) {
      if (basename(directory) !== 'node_modules') {
        const path = join(directory, 'node_modules', name);
        if (await present(path)) {
          const installed = inside(await realpath(path));
          if (!packages.has(installed)) await visit(installed);
          return installed;
        }
      }
      if (directory === root) return null;
    }
  }

  await visit(root);
  for (const [path, { name, manifest }] of packages) {
    const optional = group(manifest.optionalDependencies);
    const peers = group(manifest.peerDependenciesMeta);
    /** @type {Array<['dependency' | 'peer', Record<string, unknown>]>} */
    const groups = [
      ['dependency', { ...group(manifest.dependencies), ...optional }],
      ['peer', group(manifest.peerDependencies)],
    ];
    for (const [type, entries] of groups) {
      for (const alias of Object.keys(object(entries))) {
        const isOptional =
          type === 'peer'
            ? group(peers[alias]).optional === true
            : Object.hasOwn(optional, alias);
        if ((await dependency(alias, path)) === null && !isOptional)
          throw new Error(
            `The runtime package ${name} has an unresolved required ${type}: ${alias}.`,
          );
      }
    }
  }
  return { packages: packages.size };
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const entry = process.argv[2];
  if (entry === undefined)
    throw new Error('Give the deployed server directory.');
  const result = await checkRuntimeDependencies(entry);
  process.stdout.write(
    `Runtime dependency closure passes for ${result.packages} packages.\n`,
  );
}
