import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

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

if (import.meta.main) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!eventPath || !outputPath)
    throw new Error('GitHub event and output paths are required.');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const paths = changedPaths(event.pull_request?.base?.sha ?? event.before);
  const impact =
    paths === null
      ? { documentsOnly: false, image: true, workflows: true }
      : classifyImpact(paths);
  appendFileSync(
    outputPath,
    `source=${!impact.documentsOnly}\nimage=${impact.image}\nworkflows=${impact.workflows}\n`,
  );
}
