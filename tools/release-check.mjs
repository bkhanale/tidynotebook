/**
 * The gate of one release.
 *
 * A release is a chain: the prepare commit, the signed tag, the pushed tag,
 * the image that the tag builds, the GitHub release, and the milestone that
 * the release closes. Every link is a place where a step is forgotten, and a
 * forgotten step is silent. This check reads the real state of each link and
 * names the one that is missing.
 *
 * It runs twice. `before` runs on the prepare commit, while nothing is pushed
 * and every fault is free to repair. `after` runs once the tag is pushed and
 * the release is published, and it proves what the release really holds.
 *
 * Usage: `node tools/release-check.mjs <before|after> <version>`
 */
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import {
  changelogEntries,
  entrySections,
  releaseNotes,
} from './release-notes.mjs';
import { productName } from '../packages/core/src/product.ts';
import { root } from './workspace.mjs';

/** One result of the gate. */
/** @typedef {{ name: string; status: 'ok' | 'failed' | 'skipped'; detail: string }} Check */

/** The subject of the commit that carries the changelog entry. */
export const prepareSubject = (/** @type {string} */ version) =>
  `chore(release): prepare ${version}`;

/** The first line of the tag message, and the title of the release. */
export const releaseTitle = (/** @type {string} */ version) =>
  `${productName} ${version}`;

/** The line of `README.md` that names the current release. */
export const statusLine = (/** @type {string} */ version) =>
  `**Status:** ${version} is the current release.`;

/** @param {string} name @param {string} detail @returns {Check} */
const ok = (name, detail) => ({ name, status: 'ok', detail });

/** @param {string} name @param {string} detail @returns {Check} */
const failed = (name, detail) => ({ name, status: 'failed', detail });

/** @param {string} name @param {string} detail @returns {Check} */
const skipped = (name, detail) => ({ name, status: 'skipped', detail });

/**
 * The three numbers of a version, or null when the shape is wrong.
 *
 * @param {string} value
 * @returns {number[] | null}
 */
export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Orders two versions. A version that is absent or malformed sorts first.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareVersions(left, right) {
  const one = parseVersion(left) ?? [-1, -1, -1];
  const other = parseVersion(right) ?? [-1, -1, -1];
  for (let index = 0; index < 3; index += 1) {
    const difference = (one[index] ?? 0) - (other[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The state that the gate reads before the tag exists.
 *
 * @typedef {{
 *   version: string;
 *   today: string;
 *   changelog: string;
 *   readme: string;
 *   branch: string;
 *   headSubject: string;
 *   pending: string;
 *   localTag: boolean;
 *   remoteTag: boolean;
 *   signsTags: boolean;
 * }} BeforeState
 */

/**
 * Reads the state of the prepare commit.
 *
 * @param {BeforeState} state
 * @returns {Check[]}
 */
export function beforeChecks(state) {
  const { version } = state;
  const tag = `v${version}`;
  /** @type {Check[]} */
  const checks = [];
  const numbers = parseVersion(version);
  checks.push(
    numbers === null
      ? failed('the version', `${version} is not major.minor.patch.`)
      : ok('the version', version),
  );
  checks.push(
    state.branch === 'main'
      ? ok('the branch', 'main')
      : failed('the branch', `${state.branch}. A release leaves main.`),
  );
  checks.push(
    state.pending.trim() === ''
      ? ok('the working tree', 'clean')
      : failed(
          'the working tree',
          `${state.pending.trim().split('\n').length} pending files. Commit or remove them.`,
        ),
  );
  checks.push(
    state.headSubject === prepareSubject(version)
      ? ok('the prepare commit', state.headSubject)
      : failed(
          'the prepare commit',
          `HEAD is "${state.headSubject}". It must be "${prepareSubject(version)}".`,
        ),
  );
  const entries = changelogEntries(state.changelog);
  const newest = entries[0];
  const entry = entries.find((item) => item.version === version) ?? null;
  if (newest === undefined)
    checks.push(failed('the changelog entry', 'CHANGELOG.md holds no entry.'));
  else if (newest.version !== version)
    checks.push(
      failed(
        'the changelog entry',
        `the newest entry is ${newest.version}. Write the ${version} entry above it.`,
      ),
    );
  else if (newest.date !== state.today)
    checks.push(
      failed(
        'the changelog entry',
        `the entry is dated ${newest.date}. Today is ${state.today}.`,
      ),
    );
  else checks.push(ok('the changelog entry', `${version} - ${newest.date}`));
  const previous = entries.find((item) => item.version !== version) ?? null;
  checks.push(
    previous === null
      ? skipped('the version order', 'this is the first entry.')
      : compareVersions(version, previous.version) > 0
        ? ok('the version order', `${previous.version} to ${version}`)
        : failed(
            'the version order',
            `${version} is not above the previous entry ${previous.version}.`,
          ),
  );
  if (entry === null) {
    checks.push(skipped('the entry summary', 'the entry is not written yet.'));
    checks.push(skipped('the entry sections', 'the entry is not written yet.'));
    checks.push(skipped('the release notes', 'the entry is not written yet.'));
  } else {
    const summary = entry.body.split('\n\n')[0]?.trim() ?? '';
    checks.push(
      summary !== '' && !summary.startsWith('#')
        ? ok('the entry summary', summary.split('\n')[0] ?? '')
        : failed(
            'the entry summary',
            'the entry opens with a heading. Open it with one paragraph that states what the release gives.',
          ),
    );
    const headings = [...entry.body.matchAll(/^### +(.+)$/gm)].map((match) =>
      (match[1] ?? '').trim(),
    );
    const unknown = headings.filter(
      (heading) => !entrySections.includes(heading),
    );
    checks.push(
      headings.length === 0
        ? failed(
            'the entry sections',
            `the entry has no section. Use ${entrySections.join(', ')}.`,
          )
        : unknown.length > 0
          ? failed(
              'the entry sections',
              `${unknown.join(', ')}. Use ${entrySections.join(', ')}.`,
            )
          : ok('the entry sections', headings.join(', ')),
    );
    const notes = releaseNotes(state.changelog, version);
    checks.push(
      notes === null || notes.trim() === ''
        ? failed('the release notes', 'the entry renders no notes.')
        : ok('the release notes', `${notes.trim().split('\n').length} lines`),
    );
  }
  checks.push(
    state.readme.includes(statusLine(version))
      ? ok('the README status', statusLine(version))
      : failed(
          'the README status',
          `README.md does not hold "${statusLine(version)}".`,
        ),
  );
  checks.push(
    !state.localTag && !state.remoteTag
      ? ok('the tag is free', tag)
      : failed(
          'the tag is free',
          `${tag} exists ${state.localTag ? 'here' : 'on origin'}. A tag is never moved. Choose the next version.`,
        ),
  );
  checks.push(
    state.signsTags
      ? ok('tag signing', 'git signs an annotated tag')
      : failed(
          'tag signing',
          'git does not sign tags. Set tag.gpgsign, or sign this tag with git tag -s.',
        ),
  );
  return checks;
}

/**
 * The state that the gate reads once the tag is pushed.
 *
 * @typedef {{
 *   version: string;
 *   changelog: string;
 *   tagKind: string;
 *   tagSigned: boolean;
 *   tagSubject: string;
 *   tagCommitSubject: string;
 *   localTagSha: string;
 *   remoteTagSha: string;
 *   mainHoldsTagCommit: boolean;
 *   runStatus: string;
 *   runConclusion: string;
 *   runUrl: string;
 *   releaseName: string;
 *   releaseTag: string;
 *   releaseDraft: boolean;
 *   releasePrerelease: boolean;
 *   releaseBody: string;
 *   latestTag: string;
 *   milestoneState: string;
 *   milestoneOpenIssues: number;
 *   imageTags: string[] | null;
 * }} AfterState
 */

/**
 * Reads the state of a pushed release.
 *
 * @param {AfterState} state
 * @returns {Check[]}
 */
export function afterChecks(state) {
  const { version } = state;
  const tag = `v${version}`;
  const title = releaseTitle(version);
  /** @type {Check[]} */
  const checks = [];
  checks.push(
    state.tagKind === 'tag'
      ? state.tagSigned
        ? ok('the tag', `${tag} is annotated and signed`)
        : failed('the tag', `${tag} carries no signature.`)
      : failed(
          'the tag',
          state.tagKind === ''
            ? `${tag} is not here. Create it on the prepare commit.`
            : `${tag} is a light tag. A release tag is annotated and signed.`,
        ),
  );
  checks.push(
    state.tagSubject === title
      ? ok('the tag message', title)
      : failed(
          'the tag message',
          `it opens with "${state.tagSubject}". It must open with "${title}".`,
        ),
  );
  checks.push(
    state.tagCommitSubject === prepareSubject(version)
      ? ok('the tagged commit', state.tagCommitSubject)
      : failed(
          'the tagged commit',
          `${tag} names "${state.tagCommitSubject}". It must name "${prepareSubject(version)}".`,
        ),
  );
  checks.push(
    state.remoteTagSha === ''
      ? failed(
          'the pushed tag',
          `origin has no ${tag}. Run git push origin ${tag}.`,
        )
      : state.remoteTagSha === state.localTagSha
        ? ok('the pushed tag', `origin holds ${tag}`)
        : failed(
            'the pushed tag',
            `origin holds another commit for ${tag}. A tag is never moved.`,
          ),
  );
  checks.push(
    state.mainHoldsTagCommit
      ? ok('the pushed commit', 'origin/main holds the tagged commit')
      : failed(
          'the pushed commit',
          'origin/main does not hold the tagged commit. Run git push origin main.',
        ),
  );
  checks.push(
    state.runStatus === ''
      ? failed(
          'the image build',
          `no Release run for ${tag}. The tag push starts it.`,
        )
      : state.runStatus !== 'completed'
        ? failed(
            'the image build',
            `the run is ${state.runStatus}. ${state.runUrl}`,
          )
        : state.runConclusion === 'success'
          ? ok('the image build', state.runUrl)
          : failed(
              'the image build',
              `the run ended in ${state.runConclusion}. ${state.runUrl}`,
            ),
  );
  if (state.releaseTag === '')
    checks.push(
      failed(
        'the GitHub release',
        `no release for ${tag}. A pushed tag does not publish one. Create it.`,
      ),
    );
  else {
    checks.push(
      state.releaseTag === tag && state.releaseName === title
        ? ok('the GitHub release', title)
        : failed(
            'the GitHub release',
            `it is named "${state.releaseName}" on ${state.releaseTag}. Name it "${title}" on ${tag}.`,
          ),
    );
    checks.push(
      !state.releaseDraft && !state.releasePrerelease
        ? ok('the release state', 'published')
        : failed(
            'the release state',
            state.releaseDraft ? 'it is a draft.' : 'it is a prerelease.',
          ),
    );
    const notes = releaseNotes(state.changelog, version) ?? '';
    checks.push(
      state.releaseBody.trim() === notes.trim()
        ? ok('the release notes', 'they match the changelog entry')
        : failed(
            'the release notes',
            `they differ from the changelog entry. Run node tools/release-notes.mjs ${version} and edit the release.`,
          ),
    );
    checks.push(
      state.latestTag === tag
        ? ok('the latest release', tag)
        : failed(
            'the latest release',
            `GitHub calls ${state.latestTag} the latest.`,
          ),
    );
  }
  checks.push(
    state.milestoneState === ''
      ? skipped('the milestone', `no milestone is named ${version}.`)
      : state.milestoneOpenIssues > 0
        ? failed(
            'the milestone',
            `${state.milestoneOpenIssues} open rows. Close them or move them to the next milestone.`,
          )
        : state.milestoneState === 'closed'
          ? ok('the milestone', `${version} is closed`)
          : failed('the milestone', `${version} is still open. Close it.`),
  );
  if (state.imageTags === null)
    checks.push(
      skipped(
        'the image tags',
        'the GitHub token cannot read packages. Run gh auth refresh -s read:packages.',
      ),
    );
  else {
    const missing = [version, 'latest'].filter(
      (name) => !(state.imageTags ?? []).includes(name),
    );
    checks.push(
      missing.length === 0
        ? ok('the image tags', `${version} and latest`)
        : failed(
            'the image tags',
            `the registry has no ${missing.join(' and no ')}.`,
          ),
    );
  }
  return checks;
}

/**
 * Runs a command and returns its trimmed output. The status and the output
 * are separate, so a caller can tell an empty answer from a failure.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} directory
 * @returns {{ status: number; out: string }}
 */
function run(command, args, directory) {
  const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    out: typeof result.stdout === 'string' ? result.stdout.trim() : '',
  };
}

/** @param {Date} when @returns {string} */
export function isoDate(when) {
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/**
 * The owner and the name of the container package that the release workflow
 * pushes, from an image such as `ghcr.io/<owner>/<name>`.
 *
 * @param {string} workflow
 * @returns {{ owner: string; name: string }}
 */
export function imagePackage(workflow) {
  const image = /^\s*IMAGE:\s*(\S+)\s*$/m.exec(workflow)?.[1] ?? '';
  const parts = image.split('/');
  return {
    owner: parts.length >= 3 ? (parts.at(-2) ?? '') : '',
    name: parts.length >= 3 ? (parts.at(-1) ?? '') : '',
  };
}

/**
 * The API address that lists the versions of the image package.
 *
 * A package of an organization is listed under that organization. Any other
 * package belongs to the account that runs the check.
 *
 * @param {{ owner: string; name: string }} image
 * @param {string} ownerType The `type` of the owner account, for example `Organization`.
 * @returns {string}
 */
export function packageVersionsPath(image, ownerType) {
  const scope = ownerType === 'Organization' ? `orgs/${image.owner}` : 'user';
  return `${scope}/packages/container/${image.name}/versions?per_page=100`;
}

/**
 * @param {string} version
 * @param {string} directory
 * @returns {Promise<BeforeState>}
 */
async function readBefore(version, directory) {
  const tag = `v${version}`;
  const [changelog, readme] = await Promise.all([
    readFile(join(directory, 'CHANGELOG.md'), 'utf8').catch(() => ''),
    readFile(join(directory, 'README.md'), 'utf8').catch(() => ''),
  ]);
  return {
    version,
    today: isoDate(new Date()),
    changelog,
    readme,
    branch: run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], directory).out,
    headSubject: run('git', ['log', '-1', '--pretty=%s'], directory).out,
    pending: run('git', ['status', '--porcelain'], directory).out,
    localTag: run('git', ['tag', '--list', tag], directory).out !== '',
    remoteTag:
      run(
        'git',
        ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`],
        directory,
      ).out !== '',
    signsTags:
      run('git', ['config', '--get', 'tag.gpgsign'], directory).out === 'true',
  };
}

/**
 * @param {string} version
 * @param {string} directory
 * @returns {Promise<AfterState>}
 */
async function readAfter(version, directory) {
  const tag = `v${version}`;
  const [changelog, workflow] = await Promise.all([
    readFile(join(directory, 'CHANGELOG.md'), 'utf8').catch(() => ''),
    readFile(join(directory, '.github/workflows/release.yml'), 'utf8').catch(
      () => '',
    ),
  ]);
  const localTagSha = run(
    'git',
    ['rev-parse', `${tag}^{commit}`],
    directory,
  ).out;
  const remote = run(
    'git',
    ['ls-remote', 'origin', `refs/tags/${tag}^{}`],
    directory,
  ).out;
  run('git', ['fetch', '--quiet', 'origin', 'main'], directory);
  const release = run(
    'gh',
    [
      'release',
      'view',
      tag,
      '--json',
      'name,tagName,isDraft,isPrerelease',
      '--jq',
      '[.name, .tagName, .isDraft, .isPrerelease] | @tsv',
    ],
    directory,
  );
  const [releaseName = '', releaseTag = '', draft = '', prerelease = ''] =
    release.status === 0 ? release.out.split('\t') : [];
  const runLine = run(
    'gh',
    [
      'run',
      'list',
      '--workflow=release.yml',
      '--branch',
      tag,
      '--limit',
      '1',
      '--json',
      'status,conclusion,url',
      '--jq',
      '.[0] | [.status, .conclusion, .url] | @tsv',
    ],
    directory,
  );
  const [runStatus = '', runConclusion = '', runUrl = ''] =
    runLine.out.split('\t');
  const milestone = run(
    'gh',
    [
      'api',
      'repos/{owner}/{repo}/milestones?state=all&per_page=100',
      '--jq',
      `.[] | select(.title == "${version}") | [.state, .open_issues] | @tsv`,
    ],
    directory,
  );
  const [milestoneState = '', openIssues = '0'] = milestone.out.split('\t');
  const imageName = imagePackage(workflow);
  const ownerType = run(
    'gh',
    ['api', `users/${imageName.owner}`, '--jq', '.type'],
    directory,
  ).out;
  const image = run(
    'gh',
    [
      'api',
      packageVersionsPath(imageName, ownerType),
      '--jq',
      '.[].metadata.container.tags[]',
    ],
    directory,
  );
  return {
    version,
    changelog,
    tagKind: run('git', ['cat-file', '-t', tag], directory).out,
    tagSigned:
      run(
        'git',
        ['tag', '--list', tag, '--format=%(contents:signature)'],
        directory,
      ).out !== '',
    tagSubject: run(
      'git',
      ['tag', '--list', tag, '--format=%(contents:subject)'],
      directory,
    ).out,
    tagCommitSubject:
      localTagSha === ''
        ? ''
        : run('git', ['log', '-1', '--pretty=%s', localTagSha], directory).out,
    localTagSha,
    remoteTagSha: remote.split('\t')[0] ?? '',
    mainHoldsTagCommit:
      localTagSha !== '' &&
      run(
        'git',
        ['merge-base', '--is-ancestor', localTagSha, 'FETCH_HEAD'],
        directory,
      ).status === 0,
    runStatus,
    runConclusion,
    runUrl,
    releaseName,
    releaseTag,
    releaseDraft: draft === 'true',
    releasePrerelease: prerelease === 'true',
    releaseBody:
      release.status === 0
        ? run(
            'gh',
            ['release', 'view', tag, '--json', 'body', '--jq', '.body'],
            directory,
          ).out
        : '',
    latestTag: run(
      'gh',
      ['api', 'repos/{owner}/{repo}/releases/latest', '--jq', '.tag_name'],
      directory,
    ).out,
    milestoneState,
    milestoneOpenIssues: Number(openIssues),
    imageTags:
      image.status === 0 ? image.out.split('\n').filter(Boolean) : null,
  };
}

/**
 * @param {string} stage
 * @param {string} version
 * @param {string} [directory]
 * @returns {Promise<number>}
 */
export async function main(stage, version, directory = root) {
  const checks =
    stage === 'before'
      ? beforeChecks(await readBefore(version, directory))
      : afterChecks(await readAfter(version, directory));
  const width = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) {
    const mark =
      check.status === 'ok'
        ? 'ok  '
        : check.status === 'skipped'
          ? 'skip'
          : 'FAIL';
    process.stdout.write(
      `${mark}  ${check.name.padEnd(width)}  ${check.detail}\n`,
    );
  }
  const failures = checks.filter((check) => check.status === 'failed');
  if (failures.length > 0) {
    process.stdout.write(
      `\nThe ${stage} gate of ${version} fails on ${failures.length} of ${checks.length} checks. Repair them, then run the check again.\n`,
    );
    return 1;
  }
  process.stdout.write(
    `\nThe ${stage} gate of ${version} passes ${checks.length} checks.\n`,
  );
  return 0;
}

// The helpers above stay importable, so the check itself runs only when this
// file is the program.
if (import.meta.main) {
  const [stage, version] = process.argv.slice(2);
  if (
    (stage !== 'before' && stage !== 'after') ||
    version === undefined ||
    version.startsWith('v')
  ) {
    process.stderr.write(
      'Usage: node tools/release-check.mjs <before|after> <version>\nThe version holds no leading v, for example 0.4.0.\n',
    );
    process.exit(1);
  }
  // The check reads the repository that the caller stands in, so it works the
  // same in a worktree as it does in the main checkout.
  const here = run('git', ['rev-parse', '--show-toplevel'], process.cwd()).out;
  process.exit(await main(stage, version, here === '' ? root : here));
}
