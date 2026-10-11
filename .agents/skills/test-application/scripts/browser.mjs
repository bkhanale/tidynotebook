/**
 * Prepares a headless Chromium for the drive scripts of one worktree.
 *
 * Usage, from anywhere inside the worktree:
 *
 *     node .agents/skills/test-application/scripts/browser.mjs
 *
 * The repository holds no browser dependency (record 0066), so this installs
 * Playwright into `.local-app/` of this worktree, which git ignores, and
 * downloads its Chromium into the shared Playwright cache of the user. A
 * second run finds both and returns at once. A drive script in `.local-app/`
 * then imports `playwright` and `./session.mjs` of this directory.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// One version for every worktree, so the Chromium build that it downloads
// into `~/.cache/ms-playwright` is shared and downloaded once.
const playwrightVersion = '1.63.0';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const stateDirectory = join(root, '.local-app');
const manifest = join(stateDirectory, 'package.json');
const installed = join(
  stateDirectory,
  'node_modules',
  'playwright',
  'package.json',
);

/** @param {string} command @param {readonly string[]} args */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: stateDirectory,
    stdio: 'inherit',
  });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed.`);
}

function installedVersion() {
  if (!existsSync(installed)) return null;
  /** @type {unknown} */
  const value = JSON.parse(readFileSync(installed, 'utf8'));
  if (value === null || typeof value !== 'object') return null;
  /** @type {unknown} */
  const version = Reflect.get(value, 'version');
  return typeof version === 'string' ? version : null;
}

try {
  mkdirSync(stateDirectory, { recursive: true });
  if (!existsSync(manifest))
    writeFileSync(
      manifest,
      `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
    );
  if (installedVersion() !== playwrightVersion)
    run('npm', [
      'install',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      `playwright@${playwrightVersion}`,
    ]);
  // Downloads Chromium only when the cache lacks this build. A machine that
  // lacks a system library of Chromium fails here; `npx playwright
  // install-deps chromium` installs them and needs administrator rights.
  run('npx', ['playwright', 'install', 'chromium']);
  process.stdout.write(
    `Chromium is ready. Write drive scripts in ${stateDirectory}/.\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
