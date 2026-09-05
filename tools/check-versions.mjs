import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, record, root, workspaces } from './workspace.mjs';

const manifest = await readJson(join(root, 'package.json'));
const runtime = (await readFile(join(root, '.node-version'), 'utf8')).trim();
const failures = [];
if (process.versions.node !== runtime)
  failures.push(`Use Node ${runtime}; found ${process.versions.node}.`);
if (!/^pnpm@\d+\.\d+\.\d+$/.test(String(manifest.packageManager)))
  failures.push('Pin a stable pnpm version.');
const manager = process.env.npm_config_user_agent;
if (
  manager &&
  !manager.startsWith(String(manifest.packageManager).replace('@', '/') + ' ')
)
  failures.push('The running package manager does not match packageManager.');
const packages = [{ path: root, manifest }, ...(await workspaces())];
for (const item of packages) {
  for (const group of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ]) {
    for (const [name, version] of Object.entries(
      record(item.manifest[group]),
    )) {
      const internal = name.startsWith('@notesapp/');
      if (
        internal
          ? version !== 'workspace:*'
          : !/^\d+\.\d+\.\d+$/.test(String(version))
      )
        failures.push(
          `${item.path}: ${name} needs an exact stable version${internal ? ' (workspace:*)' : ''}.`,
        );
      if (name === 'typescript') {
        const expected =
          item.manifest.name === '@notesapp/sdk-codegen' ? '6.0.3' : '7.0.2';
        if (version !== expected)
          failures.push(`${item.path}: TypeScript must be ${expected}.`);
      }
    }
  }
  if (
    item.manifest.name === '@notesapp/sdk-codegen' &&
    record(item.manifest.devDependencies).typescript !== '6.0.3'
  )
    failures.push('SDK code generation must own TypeScript 6.0.3.');
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Version policy passed for ${packages.length} manifest(s).`);
