import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve, relative, sep } from 'node:path';
import { filesIn, root, workspaces } from './workspace.mjs';

const [kind, ...args] = process.argv.slice(2);
if (kind !== 'unit' && kind !== 'integration') {
  console.error(
    'Usage: node tools/run-tests.mjs <unit|integration> [test-name ...]',
  );
  process.exit(1);
}
const names = args.filter((arg) => arg !== '--');
let candidates;
if (kind === 'integration') {
  candidates = await filesIn(resolve(root, 'tests/integration'));
} else {
  const cwd = resolve(process.cwd());
  const packages = await workspaces();
  const selected =
    cwd === resolve(root)
      ? packages
      : packages.filter((item) => item.path === cwd);
  if (cwd !== resolve(root) && selected.length === 0) {
    console.error('Run unit tests from the root or a workspace package.');
    process.exit(1);
  }
  candidates = (
    await Promise.all(
      selected.map((item) => filesIn(resolve(item.path, 'src'))),
    )
  ).flat();
  if (cwd === resolve(root))
    candidates.push(
      ...(await filesIn(resolve(root, 'tools'))).filter(
        (file) => dirname(file) === resolve(root, 'tools'),
      ),
    );
}
candidates = candidates.filter((file) => /\.test\.(?:ts|mjs)$/.test(file));
/** @param {string} file @param {string} name */
const matches = (file, name) =>
  basename(file).replace(/\.test\.(?:ts|mjs)$/, '') === name ||
  relative(root, file).split(sep).join('/') === name;
for (const name of names) {
  if (!candidates.some((file) => matches(file, name))) {
    console.error(`No ${kind} test matches: ${name}`);
    process.exit(1);
  }
}
const selected = candidates.filter(
  (file) => names.length === 0 || names.some((name) => matches(file, name)),
);
// The test runner measures coverage and prints the report after the results.
// The report shows the product source only, so it excludes the tests
// themselves, the generated clients, and the build output. Set
// NOTESAPP_COVERAGE to `off` to hide the report while you work. Coverage is a
// measurement here, not a gate, so no threshold flag belongs in this list.
const coverageArgs =
  process.env.NOTESAPP_COVERAGE === 'off'
    ? []
    : [
        '--experimental-test-coverage',
        '--test-coverage-exclude=**/*.test.ts',
        '--test-coverage-exclude=**/*.test.mjs',
        '--test-coverage-exclude=**/generated/**',
        '--test-coverage-exclude=**/dist/**',
        '--test-coverage-exclude=tests/**',
      ];
if (selected.length === 0) {
  console.log(`No ${kind} tests exist yet.`);
} else {
  const result = spawnSync(
    process.execPath,
    ['--test', ...coverageArgs, ...selected.sort()],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
