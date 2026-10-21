import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { record } from './workspace.mjs';

/** Select checks from the complete push diff. Unknown paths require source checks.
 * @param {string[]} paths */
export function classifyImpact(paths) {
  return {
    documentsOnly:
      paths.length > 0 &&
      paths.every((path) =>
        /^(?:docs\/.*\.md|(?:AGENTS|README|CHANGELOG|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT)\.md)$/.test(
          path,
        ),
      ),
    image: paths.some((path) =>
      /^(?:Dockerfile$|\.dockerignore$|docker\/|tools\/[^/]*sources[^/]*\.json$|pnpm-lock\.yaml$|patches\/|(?:docker-)?compose(?:[.-][^/]*)?\.ya?ml$)/.test(
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
 * @param {string} base */
export function hasPassingCheck(payload, base) {
  const runs = record(payload).check_runs;
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
          record(run.app).id === 15368,
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
    const reply = await fetch(
      `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/commits/${base}/check-runs?check_name=Check&per_page=100`,
      {
        headers: {
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(3000),
      },
    );
    return reply.ok && hasPassingCheck(await reply.json(), base);
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
