/** Builds the application, starts the test service, and runs the local server. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const defaultPort = 3000;
/** @type {import('node:child_process').ChildProcess | null} */
let activeChild = null;
let interrupted = false;

/** Accept an optional port so two local runs can use the same test service. */
/** @param {readonly string[]} args */
export function readPort(args) {
  if (args.length === 0) return defaultPort;
  if (
    args.length !== 2 ||
    args[0] !== '--port' ||
    !/^[1-9][0-9]{0,4}$/.test(args[1] ?? '')
  ) {
    throw new Error('Usage: pnpm dev:app [--port <1-65535>]');
  }
  const port = Number(args[1]);
  if (port > 65535) throw new Error('The local port must be at most 65535.');
  return port;
}

/** @param {string} command @param {readonly string[]} args */
async function run(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  activeChild = child;
  try {
    /** @type {Promise<number | null>} */
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (status) => resolve(status));
    });
    const code = await exited;
    if (code !== 0 && !interrupted)
      throw new Error(`${command} could not complete setup.`);
  } finally {
    activeChild = null;
  }
}

function stop() {
  interrupted = true;
  activeChild?.kill('SIGINT');
}

/** @param {readonly string[]} args */
export async function main(args) {
  const port = readPort(args);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await run('pnpm', ['-r', '--if-present', 'build']);
    if (interrupted) return;
    await run('tools/test-database/ensure-postgres.sh', []);
    if (interrupted) return;
    await run(process.execPath, [
      'tests/integration/support/dev-app.ts',
      String(port),
    ]);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'The local application could not start.'}\n`,
    );
    process.exitCode = 1;
  }
}
