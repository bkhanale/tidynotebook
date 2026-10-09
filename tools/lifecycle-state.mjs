/** Exact input proof and exclusive state for lifecycle commands. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  openSync,
  closeSync,
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
    .filter(([key]) =>
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
  const containerRuntimeDigest = digest(
    command(cwd, 'docker', ['version', '--format', '{{json .}}']),
  );
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
  const common = resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']));
  const file = join(common, `lifecycle-${name}.lock`);
  let descriptor;
  try {
    descriptor = openSync(file, 'wx', 0o600);
  } catch (error) {
    if (record(error).code === 'EEXIST')
      throw new Error(
        `The ${name} lock exists. Check its process before recovery.`,
      );
    throw error;
  }
  writeFileSync(
    descriptor,
    JSON.stringify({
      pid: process.pid,
      cwd,
      startedAt: new Date().toISOString(),
    }),
  );
  closeSync(descriptor);
  return () => rmSync(file);
}
