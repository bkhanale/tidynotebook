import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** Remote cache is optional. Missing runtime credentials select a cold build.
 * @param {string} arch
 * @param {NodeJS.ProcessEnv} [env] */
export function imageCache(arch, env = process.env) {
  if (!['amd64', 'arm64'].includes(arch))
    throw new Error('Use amd64 or arm64 for the image cache.');
  if (
    env.CACHE_DISABLE === 'true' ||
    !env.ACTIONS_RUNTIME_TOKEN ||
    !env.ACTIONS_RESULTS_URL
  )
    return { from: [], to: [] };
  const cache = `type=gha,version=2,scope=core-${arch},timeout=60s`;
  const write =
    env.CACHE_WRITE === 'true' &&
    env.GITHUB_REPOSITORY === 'tidynotebook/tidynotebook' &&
    env.GITHUB_REF === 'refs/heads/main' &&
    ['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME ?? '');
  return {
    from: [cache],
    to: write ? [`${cache},mode=max,ignore-error=true`] : [],
  };
}

/** Retry a failed remote-cache build without remote cache. The retry must pass.
 * @param {string[]} args
 * @param {(args:string[]) => number} run
 * @param {string[]} cacheArgs */
export function buildWithCache(args, run, cacheArgs) {
  const status = run([...args, ...cacheArgs]);
  if (status === 0 || cacheArgs.length === 0) return status;
  process.stderr.write(
    'Build failed with remote cache. Retry without remote cache.\n',
  );
  return run(args);
}

if (import.meta.main) {
  const [mode, ...args] = process.argv.slice(2);
  const cache = imageCache(process.env.ARCH ?? 'amd64');
  /** @param {string[]} command */
  const run = (command) =>
    spawnSync('docker', command, { stdio: 'inherit' }).status ?? 1;
  if (mode === 'native') {
    process.exitCode = buildWithCache(['buildx', 'build', ...args], run, [
      ...cache.from.flatMap((value) => ['--cache-from', value]),
      ...cache.to.flatMap((value) => ['--cache-to', value]),
    ]);
  } else if (mode === 'compose') {
    const base = ['compose', '-f', 'docker-compose.yml'];
    const temporary = process.env.RUNNER_TEMP;
    if (!temporary) throw new Error('RUNNER_TEMP is required.');
    const warm = ['-f', join(temporary, 'ci-image.yaml')];
    const cold = ['-f', join(temporary, 'ci-image-cold.yaml')];
    const status = run([...base, ...warm, 'build']);
    if (status !== 0 && cache.from.length > 0) {
      process.stderr.write(
        'Build failed with remote cache. Retry without remote cache.\n',
      );
      process.exitCode = run([...base, ...cold, 'build']);
    } else process.exitCode = status;
  } else throw new Error('Use native or compose for the image build.');
}
