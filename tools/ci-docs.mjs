import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyImpact } from './ci-scope.mjs';
import { record, root } from './workspace.mjs';

/** Build a one-package npm lock from the checked pnpm identity.
 * Prettier has no dependencies. Refuse an unknown lockfile format.
 * @param {string} version
 * @param {string} lockfile */
export function formatterLock(version, lockfile) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('Prettier must have an exact version.');
  const section = lockfile
    .split(`\n  prettier@${version}:\n`)[1]
    ?.split('\n\n')[0];
  const integrity = section?.match(
    /^    resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}$/m,
  )?.[1];
  if (!integrity) throw new Error('Prettier has no locked integrity.');
  return {
    name: 'ci-format',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'ci-format', dependencies: { prettier: version } },
      'node_modules/prettier': {
        version,
        integrity,
        resolved: `https://registry.npmjs.org/prettier/-/prettier-${version}.tgz`,
        bin: { prettier: 'bin/prettier.cjs' },
      },
    },
  };
}

/** Deleted paths need no formatter. Renames check the new path.
 * @param {string} base */
export function documentFiles(base) {
  if (!/^[a-f0-9]{40}$/.test(base))
    throw new Error('The document base is invalid.');
  const files = execFileSync(
    'git',
    [
      'diff',
      '--name-only',
      '--no-renames',
      '--diff-filter=ACM',
      '-z',
      base,
      'HEAD',
    ],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  if (files.length && !classifyImpact(files).documentsOnly)
    throw new Error('These paths require full source checks.');
  return files;
}

if (import.meta.main) {
  const temporary = process.env.RUNNER_TEMP;
  if (!temporary) throw new Error('RUNNER_TEMP is required.');
  const directory = join(temporary, 'ci-format');
  if (process.argv[2] === 'prepare') {
    const manifest = record(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
    );
    const version = record(manifest.devDependencies).prettier;
    if (typeof version !== 'string')
      throw new Error('The Prettier version is missing.');
    const lock = formatterLock(
      version,
      readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'),
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'ci-format',
        private: true,
        dependencies: { prettier: version },
      }),
    );
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
  } else if (process.argv[2] === 'check') {
    const files = documentFiles(process.env.DOCS_BASE ?? '');
    if (files.length)
      execFileSync(
        process.execPath,
        [
          join(directory, 'node_modules/prettier/bin/prettier.cjs'),
          '--check',
          '--',
          ...files,
        ],
        { cwd: root, stdio: 'inherit' },
      );
    execFileSync(process.execPath, ['tools/check-docs.mjs'], {
      cwd: root,
      stdio: 'inherit',
    });
  } else throw new Error('Select prepare or check.');
}
