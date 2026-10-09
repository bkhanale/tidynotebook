/** Exact input proof and exclusive state for lifecycle commands. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  linkSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { record } from './workspace.mjs';

/** @param {string | Buffer} bytes */
export function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
/** @param {string} cwd @param {string} command @param {string[]} args */
export function command(cwd, command, args) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
/** @param {string} cwd @param {string[]} args */
export function git(cwd, args) {
  return command(cwd, 'git', args);
}
/** @param {string} cwd */
export function stateDirectory(cwd) {
  return join(cwd, '.tooling/lifecycle');
}
/** @param {string} file @param {unknown} value */
export function save(file, value) {
  mkdirSync(resolve(file, '..'), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
  renameSync(temporary, file);
}
/** @param {string} file */
export function readState(file) {
  try {
    return record(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    if (record(error).code === 'ENOENT') return {};
    throw error;
  }
}
/** @param {string} cwd */
export function snapshot(cwd) {
  if (git(cwd, ['status', '--porcelain']) !== '')
    throw new Error('Commit the pending files before proof.');
  const commit = git(cwd, ['rev-parse', 'HEAD']);
  const tree = git(cwd, ['rev-parse', 'HEAD^{tree}']);
  const origin = git(cwd, ['config', '--get', 'remote.origin.url']);
  const transportDigest = digest(git(cwd, ['remote', 'get-url', 'origin']));
  const pnpm = command(cwd, 'pnpm', ['--version']);
  const scripts = record(
    record(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))).scripts,
  );
  const toolDigest = digest(
    Buffer.concat(
      [
        'lifecycle-state.mjs',
        'lifecycle.mjs',
        'release.mjs',
        'release-manifest.mjs',
      ].map((name) => readFileSync(join(cwd, 'tools', name))),
    ),
  );
  const environment = Object.entries(process.env)
    .filter(
      ([key]) =>
        key !== 'PNPM_PACKAGE_NAME' &&
        key !== 'PNPM_SCRIPT_SRC_DIR' &&
        /^(?:NOTESAPP_|PG|DOCKER_|CI$|TZ$|NODE_OPTIONS$|PNPM_)/.test(key),
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [
      key,
      value,
      key.endsWith('_FILE') && value
        ? digest(readFileSync(resolve(cwd, value)))
        : null,
    ]);
  const environmentDigest = digest(JSON.stringify(environment));
  let containerRuntimeDigest;
  try {
    containerRuntimeDigest = digest(
      command(cwd, 'docker', ['version', '--format', '{{json .}}']),
    );
  } catch {
    throw new Error(
      'Docker cannot be checked. Start Docker, then run proof again.',
    );
  }
  const inputs = {
    commit,
    tree,
    origin,
    transportDigest,
    containerRuntimeDigest,
    runtime: process.version,
    platform: process.platform,
    architecture: process.arch,
    environmentDigest,
    pnpm,
    gates: { verify: scripts.verify, image: scripts['test:image'] },
    toolDigest,
  };
  return { ...inputs, inputDigest: digest(JSON.stringify(inputs)) };
}
/** Local receipts are a same-user cache, not an external attestation.
 * @param {unknown} value @param {ReturnType<typeof snapshot>} input @param {string[]} gates @param {string} [cwd]
 */
export function validProof(value, input, gates, cwd) {
  const proof = record(value),
    passed = proof.gates,
    results = proof.gateResults;
  if (
    proof.schemaVersion !== 1 ||
    proof.inputDigest !== input.inputDigest ||
    proof.commit !== input.commit ||
    proof.toolDigest !== input.toolDigest ||
    proof.runtime !== input.runtime ||
    proof.result !== 'passed' ||
    !Array.isArray(passed) ||
    !passed.every((gate) => gate === 'verify' || gate === 'test:image') ||
    !gates.every((gate) => passed.includes(gate)) ||
    !Array.isArray(results)
  )
    return false;
  return passed.every((gate) =>
    results.some((value) => {
      const result = record(value);
      if (
        result.gate !== gate ||
        result.exitCode !== 0 ||
        result.inputDigest !== input.inputDigest ||
        result.command !== `pnpm ${gate}` ||
        typeof result.logDigest !== 'string' ||
        typeof result.logFile !== 'string'
      )
        return false;
      if (cwd === undefined) return true;
      if (
        !resolve(result.logFile).startsWith(resolve(stateDirectory(cwd)) + '/')
      )
        return false;
      try {
        return digest(readFileSync(result.logFile)) === result.logDigest;
      } catch {
        return false;
      }
    }),
  );
}
/** @param {string} cwd @param {string} name @returns {() => void} */
export function lock(cwd, name) {
  const directory = resolve(
    cwd,
    git(cwd, [
      'rev-parse',
      name === 'proof' ? '--git-dir' : '--git-common-dir',
    ]),
  );
  return acquireLock(join(directory, `lifecycle-${name}.lock`), cwd, name);
}

/** Recover only an owner whose process is demonstrably absent.
 * @param {unknown} value
 */
function deadOwner(value) {
  const owner = record(value);
  if (
    !Number.isSafeInteger(owner.pid) ||
    typeof owner.pid !== 'number' ||
    owner.pid <= 0
  )
    return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return record(error).code === 'ESRCH';
  }
}

/** Publish a complete owner record. Recovery is serialized for that owner,
 * then rechecks identity so it cannot remove a replacement owner's lock.
 * @param {string} file @param {string} cwd @param {string} name
 * @returns {() => void}
 */
function acquireLock(file, cwd, name) {
  const token = randomUUID();
  const candidate = `${file}.${token}.tmp`;
  writeFileSync(
    candidate,
    JSON.stringify({
      token,
      pid: process.pid,
      cwd,
      startedAt: new Date().toISOString(),
    }),
    { mode: 0o600, flag: 'wx' },
  );
  try {
    while (true) {
      try {
        linkSync(candidate, file);
        return () => {
          if (readState(file).token === token) rmSync(file);
        };
      } catch (error) {
        if (record(error).code !== 'EEXIST') throw error;
      }
      const owner = readState(file);
      if (Object.keys(owner).length === 0 && !existsSync(file)) continue;
      if (!deadOwner(owner))
        throw new Error(
          `The ${name} lock exists. Its process must stop before recovery.`,
        );
      // Older receipts have no token. A digest binds their complete owner record.
      const identity = digest(JSON.stringify(owner));
      const recovery = acquireLock(
        `${file}.recover-${identity.slice(7)}`,
        cwd,
        name,
      );
      try {
        const current = readState(file);
        if (digest(JSON.stringify(current)) === identity && deadOwner(current))
          rmSync(file);
      } finally {
        recovery();
      }
    }
  } finally {
    rmSync(candidate, { force: true });
  }
}
