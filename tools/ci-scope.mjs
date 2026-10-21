import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { record } from './workspace.mjs';

// Build metadata, image tooling and notice inputs. Application source changes
// still use source proof; these paths also need the Compose smoke test.
const imageFiles = new Set([
  'Dockerfile',
  '.dockerignore',
  'LICENSE',
  'README.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.node-version',
  '.npmrc',
  '.pnpmfile.cjs',
  'tsconfig.json',
  'tsconfig.base.json',
  'tools/ci-image.mjs',
  'tools/runtime-dependencies.mjs',
  'tools/native-sources.mjs',
  'tools/distribution-target.mjs',
  'tools/distribution-notices.mjs',
  'tools/workspace.mjs',
  'tools/base-packages.json',
  'tools/precompress-assets.mjs',
  'apps/web/vite.config.ts',
  'packages/ui/THIRD_PARTY_LICENSES.md',
]);

/** Select checks from the complete push diff. Unknown paths require source checks.
 * @param {string[]} paths */
export function classifyImpact(paths) {
  return {
    documentsOnly:
      paths.length > 0 &&
      paths.every((path) =>
        /^docs\/(?:decisions|design|plans|audits)\/.*\.md$/.test(path),
      ),
    image: paths.some(
      (path) =>
        imageFiles.has(path) ||
        /^(?:docker\/|tests\/image\/|\.github\/actions\/image\/|tools\/third-party\/|tools\/[^/]*sources[^/]*\.json$|patches\/|(?:docker-)?compose(?:[.-][^/]*)?\.ya?ml$|(?:apps|packages)\/[^/]+\/(?:package\.json|tsconfig(?:\.[^/]+)?\.json)$|tools\/sdk-codegen\/(?:package|tsconfig)\.json$)/.test(
          path,
        ),
    ),
    workflows: paths.some((path) => path.startsWith('.github/')),
  };
}

/** Diff both sides, including deleted and renamed paths. Fall back to full checks.
 * @param {string | undefined} base */
export function changedPaths(base) {
  if (!base || /^0+$/.test(base)) return null;
  try {
    return execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
  } catch {
    return null;
  }
}

/** A successful aggregate from GitHub Actions proves this exact base.
 * @param {unknown} payload
 * @param {string} base
 * @param {unknown} workflows */
export function hasPassingCheck(payload, base, workflows) {
  const runs = record(payload).check_runs;
  const candidates = record(workflows).workflow_runs;
  if (!Array.isArray(candidates)) return false;
  const trusted = candidates
    .map(record)
    .filter(
      (run) =>
        run.head_sha === base &&
        run.path === '.github/workflows/ci.yml' &&
        ['push', 'workflow_dispatch'].includes(String(run.event)),
    );
  return (
    Array.isArray(runs) &&
    runs
      .map(record)
      .some(
        (run) =>
          run.name === 'Check' &&
          run.head_sha === base &&
          run.status === 'completed' &&
          run.conclusion === 'success' &&
          record(run.app).id === 15368 &&
          trusted.some(
            (workflow) =>
              workflow.check_suite_id === record(run.check_suite).id &&
              typeof workflow.check_suite_id === 'number',
          ),
      )
  );
}

/** Refuse a short diff when the preceding push did not finish proof.
 * @param {string[] | null} paths
 * @param {boolean} basePassed */
export function checkedImpact(paths, basePassed) {
  return paths !== null && basePassed
    ? classifyImpact(paths)
    : { documentsOnly: false, image: true, workflows: true };
}

/** API errors, missing access and timeouts all select the full scope.
 * @param {string | undefined} base */
async function previousCheckPassed(base) {
  if (!base || !/^[a-f0-9]{40}$/.test(base) || !process.env.GITHUB_TOKEN)
    return false;
  try {
    const repository = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`;
    const options = {
      headers: {
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(3000),
    };
    const replies = await Promise.all([
      fetch(
        `${repository}/commits/${base}/check-runs?check_name=Check&per_page=100`,
        options,
      ),
      fetch(
        `${repository}/actions/workflows/ci.yml/runs?head_sha=${base}&event=push&per_page=100`,
        options,
      ),
      fetch(
        `${repository}/actions/workflows/ci.yml/runs?head_sha=${base}&event=workflow_dispatch&per_page=100`,
        options,
      ),
    ]);
    if (!replies.every((reply) => reply.ok)) return false;
    const [checks, push, manual] = await Promise.all(
      replies.map(async (reply) => record(await reply.json())),
    );
    const pushed = push?.workflow_runs;
    const dispatched = manual?.workflow_runs;
    if (!Array.isArray(pushed) || !Array.isArray(dispatched)) return false;
    return hasPassingCheck(checks, base, {
      workflow_runs: [...pushed.map(record), ...dispatched.map(record)],
    });
  } catch {
    return false;
  }
}

if (import.meta.main) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!eventPath || !outputPath)
    throw new Error('GitHub event and output paths are required.');
  const event = record(JSON.parse(readFileSync(eventPath, 'utf8')));
  const base = record(record(event.pull_request).base).sha ?? event.before;
  const baseSha = typeof base === 'string' ? base : undefined;
  const paths = changedPaths(baseSha);
  const basePassed =
    process.env.GITHUB_EVENT_NAME === 'pull_request' ||
    (await previousCheckPassed(baseSha));
  const impact = checkedImpact(paths, basePassed);
  appendFileSync(
    outputPath,
    `source=${!impact.documentsOnly}\nimage=${impact.image}\nworkflows=${impact.workflows}\n`,
  );
}
