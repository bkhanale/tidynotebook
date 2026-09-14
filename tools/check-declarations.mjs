/**
 * Refuses the type-aware lint while the workspace has no build output.
 *
 * `oxlint --type-aware` reads the emitted declaration of each workspace
 * package. A fresh checkout holds no `dist` directory, so the linter resolves
 * those imports to `any` and reports many unsafe assignments. This check runs
 * first and reports the one cause instead of that list.
 */
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { record, root, workspaces } from './workspace.mjs';

/**
 * Finds the workspace packages that declare a type entry with no file behind
 * it yet.
 *
 * @param {string} [directory]
 * @returns {Promise<string[]>}
 */
export async function missingDeclarations(directory = root) {
  const missing = [];
  for (const item of await workspaces(directory)) {
    const types = record(record(item.manifest.exports)['.']).types;
    if (typeof types !== 'string') continue;
    const found = await access(resolve(item.path, types)).then(
      () => true,
      () => false,
    );
    if (!found) missing.push(String(item.manifest.name));
  }
  return missing;
}

/** @param {string} directory @returns {Promise<number>} */
export async function main(directory) {
  const missing = await missingDeclarations(directory);
  if (missing.length > 0) {
    process.stderr.write(
      'The type-aware lint reads the declaration files that the build writes, and they are absent. Run `pnpm build` first, then run `pnpm lint:types` again.\n',
    );
    return 1;
  }
  process.stdout.write(
    'Declarations: every workspace package has its build output.\n',
  );
  return 0;
}

// The helpers above stay importable, so the check itself runs only when this
// file is the program.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--root')) {
    process.stderr.write(
      'Usage: node tools/check-declarations.mjs [--root <directory>]\n',
    );
    process.exit(1);
  }
  process.exit(await main(resolve(args[1] ?? root)));
}
