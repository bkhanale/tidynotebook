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
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
  changelogEntries,
  entrySections,
  releaseNotes,
} from './release-notes.mjs';
import { productName } from '../packages/core/src/product.ts';
import { record, root } from './workspace.mjs';
import {
  digest,
  git,
  readState,
  snapshot,
  stateDirectory,
  validProof,
} from './lifecycle-state.mjs';

import {
  attestationArguments,
  publishedRelease,
  generateOperatorContract,
  parseManifest,
  operatorDigests,
  migrationMetadata,
} from './release-manifest.mjs';
import { githubRepository } from './pr-screenshots.mjs';

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
 *   releaseDate?: string;
 *   changelog: string;
 *   readme: string;
 *   headSha: string;
 *   mainSha: string;
 *   holdsOriginMain: boolean;
 *   headSubject: string;
 *   pending: string;
 *   localTag: boolean;
 *   remoteTag: boolean;
 *   signsTags: boolean;
 *   imageBuild: string;
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
  // The tip of main, not the name of the branch: a release runs from its
  // worktree, and `git push origin main` pushes the local main (record 0204).
  checks.push(
    state.mainSha === ''
      ? failed('the branch', 'there is no published main.')
      : !state.holdsOriginMain
        ? failed('the branch', 'The release source is not in published main.')
        : ok('the branch', 'published main holds the release source'),
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
  else if (newest.date !== (state.releaseDate ?? state.today))
    checks.push(
      failed(
        'the changelog entry',
        `the entry is dated ${newest.date}. The fixed release date is ${state.releaseDate ?? state.today}.`,
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
  checks.push(
    state.imageBuild === ''
      ? ok('the image build', 'the prepare commit builds the image')
      : failed('the image build', state.imageBuild),
  );
  return checks;
}

/**
 * The line that names the cause of a failed image build.
 *
 * The build prints every step, so the first line that states an error names
 * the cause, and its step number and time are left out.
 *
 * @param {string} output
 * @returns {string}
 */
export function buildFailure(output) {
  const lines = output.split('\n').map((line) => line.trim());
  const cause =
    lines.find((line) => /\berror\b/i.test(line)) ??
    lines.filter(Boolean).at(-1) ??
    '';
  return cause.replace(/^#\d+\s+[\d.]+\s+/, '');
}

/**
 * Builds the image of one commit as the release workflow does, and returns
 * the cause of a failure, or the empty string when the image builds.
 *
 * The context is `git archive` of the commit in a temporary folder, so the
 * build reads the committed tree and `.dockerignore`, as a checkout does. A
 * folder, not a stream: BuildKit loses its session over a streamed context
 * when the Dockerfile names a syntax frontend. The build exports no image.
 *
 * @param {string} directory
 * @param {string} [revision]
 * @returns {string}
 */
export function buildImage(directory, revision = 'HEAD') {
  const context = mkdtempSync(join(tmpdir(), 'release-image-'));
  try {
    const archive = spawnSync('git', ['archive', '--format=tar', revision], {
      cwd: directory,
      maxBuffer: 2 ** 30,
    });
    if (archive.status !== 0) return `git archive of ${revision} failed.`;
    const unpack = spawnSync('tar', ['-x', '-C', context], {
      input: archive.stdout,
    });
    if (unpack.status !== 0) return `tar could not unpack ${revision}.`;
    process.stderr.write(
      `Building the image of ${revision}. This takes some minutes.\n`,
    );
    const build = spawnSync(
      'docker',
      ['build', '--progress=plain', '--output', 'type=cacheonly', context],
      { cwd: directory, maxBuffer: 2 ** 28 },
    );
    if (build.error !== undefined)
      return 'Docker is not here. The gate builds the image before the tag.';
    if (build.status === 0) return '';
    return buildFailure(
      `${build.stdout.toString()}\n${build.stderr.toString()}`,
    );
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
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
 *   runSha: string;
 *   imageDigest: string;
 *   imageRevision: string;
 *   imageProvenance: boolean;
 *   assetsError: string;
 *   releaseName: string;
 *   releaseTag: string;
 *   releaseDraft: boolean;
 *   releasePrerelease: boolean;
 *   releaseBody: string;
 *   latestTag: string;
 *   milestoneState: string;
 *   milestoneOpenIssues: number;
 *   imageOwner: string;
 *   imageOwnerType: string;
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
  checks.push(
    state.runSha === state.localTagSha
      ? ok('the image source', state.runSha)
      : failed(
          'the image source',
          'The image job does not build the signed tag commit.',
        ),
  );
  checks.push(
    /^sha256:[a-f0-9]{64}$/.test(state.imageDigest) &&
      state.imageRevision === state.localTagSha &&
      state.imageProvenance
      ? ok('the image identity', state.imageDigest)
      : failed(
          'the image identity',
          'The image digest, source, or provenance cannot be proved.',
        ),
  );
  checks.push(
    state.assetsError === ''
      ? ok(
          'the release assets',
          'the manifest and operator contract match the fixed source and proof',
        )
      : failed(
          'the release assets',
          state.assetsError || 'The release asset proof is missing.',
        ),
  );
  // A tag with no image gets no release. Its next patch carries the release.
  const noImage =
    state.runStatus === 'completed' && state.runConclusion !== 'success';
  if (state.releaseTag === '')
    checks.push(
      failed(
        'the GitHub release',
        noImage
          ? `no release for ${tag}, and it gets none: its image did not build. Release the next patch.`
          : `no release for ${tag}. A pushed tag does not publish one. Create it.`,
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
  }
  checks.push(
    state.milestoneState === ''
      ? failed('the milestone', `no milestone is named ${version}.`)
      : state.milestoneOpenIssues > 0
        ? failed(
            'the milestone',
            `${state.milestoneOpenIssues} open rows. Close them or move them to the next milestone.`,
          )
        : state.milestoneState === 'closed'
          ? ok('the milestone', `${version} is closed`)
          : failed('the milestone', `${version} is still open. Close it.`),
  );
  if (state.imageOwnerType === '')
    checks.push(
      failed(
        'the image tags',
        `GitHub names no account "${state.imageOwner}". Check IMAGE in .github/workflows/release.yml.`,
      ),
    );
  else if (state.imageTags === null)
    checks.push(
      failed(
        'the image tags',
        'the GitHub token cannot read packages. Run gh auth refresh -s read:packages.',
      ),
    );
  else {
    const missing = [version].filter(
      (name) => !(state.imageTags ?? []).includes(name),
    );
    checks.push(
      missing.length === 0
        ? ok('the image tags', version)
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
  if (parts.length < 3) return { owner: '', name: '' };
  const [owner = '', name = ''] = parts.slice(-2);
  return { owner, name };
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
  const releaseState = readState(
    join(stateDirectory(directory), 'release.json'),
  );
  const head = run('git', ['rev-parse', 'HEAD'], directory).out;
  return {
    version,
    today: isoDate(new Date()),
    ...(releaseState.version === version &&
    releaseState.prepareCommit === head &&
    typeof releaseState.date === 'string'
      ? { releaseDate: releaseState.date }
      : {}),
    changelog,
    readme,
    headSha: run('git', ['rev-parse', 'HEAD'], directory).out,
    mainSha: run(
      'git',
      ['rev-parse', '--verify', 'refs/remotes/origin/main'],
      directory,
    ).out,
    holdsOriginMain:
      run('git', ['fetch', '--quiet', 'origin', 'main'], directory).status ===
        0 &&
      run(
        'git',
        ['merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD'],
        directory,
      ).status === 0,
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
    imageBuild: validProof(
      readState(join(stateDirectory(directory), 'proof.json')),
      snapshot(directory),
      ['verify', 'test:image'],
      directory,
    )
      ? ''
      : buildImage(directory),
  };
}

/**
 * @param {string} version
 * @param {string} directory
 * @returns {Promise<AfterState>}
 */
async function readAfter(version, directory) {
  const tag = `v${version}`;
  const localTagSha = run(
    'git',
    ['rev-parse', `${tag}^{commit}`],
    directory,
  ).out;
  const changelog = run(
    'git',
    ['show', `${localTagSha}:CHANGELOG.md`],
    directory,
  ).out;
  const workflow = run(
    'git',
    ['show', `${localTagSha}:.github/workflows/release.yml`],
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
      'status,conclusion,url,headSha',
      '--jq',
      '.[0] | [.status, .conclusion, .url, .headSha] | @tsv',
    ],
    directory,
  );
  const [runStatus = '', runConclusion = '', runUrl = '', runSha = ''] =
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
      `.[] | select(.metadata.container.tags | index("${version}")) | .metadata.container.tags[]`,
    ],
    directory,
  );
  const imageReference = `ghcr.io/${imageName.owner}/${imageName.name}`;
  const pull = run(
    'docker',
    ['pull', `${imageReference}:${version}`],
    directory,
  );
  const imageDigest =
    pull.status === 0
      ? (run(
          'docker',
          [
            'image',
            'inspect',
            '--format',
            '{{index .RepoDigests 0}}',
            `${imageReference}:${version}`,
          ],
          directory,
        ).out.split('@')[1] ?? '')
      : '';
  const imageRevision =
    pull.status === 0
      ? run(
          'docker',
          [
            'image',
            'inspect',
            '--format',
            '{{index .Config.Labels "org.opencontainers.image.revision"}}',
            `${imageReference}:${version}`,
          ],
          directory,
        ).out
      : '';
  const repository = githubRepository(
    git(directory, ['config', '--get', 'remote.origin.url']),
  );
  const imageProvenance =
    imageDigest !== '' &&
    run(
      'gh',
      attestationArguments(
        repository,
        localTagSha,
        tag,
        `${imageReference}@${imageDigest}`,
      ),
      directory,
    ).status === 0;
  let assetsError = '';
  try {
    const observed = publishedRelease(directory, tag);
    if (!observed.release) throw new Error('The published release is missing.');
    const contract = observed.assets.get('operator-contract.json'),
      manifest = observed.assets.get('release-manifest.json');
    if (!contract || !manifest)
      throw new Error('The published release asset is missing.');
    const parent = stateDirectory(directory);
    mkdirSync(parent, { recursive: true });
    const temporary = mkdtempSync(join(parent, 'asset-read-'));
    try {
      const manifestValue = parseManifest(
        JSON.parse(manifest.toString('utf8')),
      );
      const archive = spawnSync('git', ['archive', localTagSha], {
        cwd: directory,
        maxBuffer: 64 * 1024 * 1024,
      });
      if (
        archive.status !== 0 ||
        spawnSync('tar', ['-xf', '-', '-C', temporary], {
          input: archive.stdout,
        }).status !== 0
      )
        throw new Error('The fixed release source cannot be read.');
      const files = git(directory, [
        'ls-tree',
        '-r',
        '--name-only',
        localTagSha,
      ])
        .split('\n')
        .filter(Boolean);
      const contractFile = join(temporary, 'operator-contract.json');
      generateOperatorContract(directory, contractFile, temporary);
      const operator = await operatorDigests(temporary, files),
        migration = migrationMetadata(temporary, files);
      if (
        manifestValue.repository !== repository ||
        manifestValue.version !== version ||
        manifestValue.tag !== tag ||
        manifestValue.source.commit !== localTagSha ||
        manifestValue.source.tree !==
          git(directory, ['rev-parse', `${localTagSha}^{tree}`]) ||
        manifestValue.image.reference !== imageReference ||
        manifestValue.image.digest !== imageDigest ||
        digest(contract) !== manifestValue.operator.contractDigest ||
        manifestValue.operator.contractDigest !==
          digest(await readFile(contractFile)) ||
        manifestValue.operator.surfaceDigest !== operator.surfaceDigest ||
        manifestValue.migration.digest !== migration.digest ||
        manifestValue.migration.requiredSchemaVersion !==
          migration.requiredSchemaVersion
      )
        throw new Error(
          'The published release asset differs from the fixed source or image.',
        );
      const saved = readState(join(stateDirectory(directory), 'release.json'));
      if (saved.version === version && saved.releaseCommit === localTagSha) {
        const expected = record(saved.assetDigests);
        if (
          digest(manifest) !== expected['release-manifest.json'] ||
          digest(contract) !== expected['operator-contract.json']
        )
          throw new Error(
            'The published release asset differs from its saved publication bytes.',
          );
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    assetsError = error instanceof Error ? error.message : String(error);
  }
  return {
    version,
    changelog,
    imageDigest,
    imageRevision,
    imageProvenance,
    assetsError,
    tagKind: run('git', ['cat-file', '-t', tag], directory).out,
    tagSigned: run('git', ['verify-tag', tag], directory).status === 0,
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
    runSha,
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
    imageOwner: imageName.owner,
    imageOwnerType: imageName.owner === '' ? '' : ownerType,
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
