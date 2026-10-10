/** Publish remote prepared artifacts. No source gate or local receipt is read. */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogEntries } from './release-notes.mjs';
import { parseManifest, publishedRelease } from './release-manifest.mjs';
import { command, digest, git, lock } from './lifecycle-state.mjs';
import { githubRepository } from './pr-screenshots.mjs';
import { record } from './workspace.mjs';
import {
  compareVersions,
  parseVersion,
  releaseTitle,
} from './release-check.mjs';

/** @param {string} cwd @param {string} reference */
function remoteImage(cwd, reference) {
  const result = spawnSync(
    'docker',
    [
      'buildx',
      'imagetools',
      'inspect',
      reference,
      '--format',
      '{{json .Manifest}}',
    ],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    if (
      /manifest unknown|no such manifest|manifest.*not found/i.test(
        result.stderr ?? '',
      ) &&
      !/denied|unauthorized|timeout/i.test(result.stderr ?? '')
    )
      return null;
    throw new Error(
      'The registry read is uncertain. Check access before retry.',
    );
  }
  const image = record(JSON.parse(result.stdout));
  if (
    typeof image.digest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(image.digest)
  )
    throw new Error('The registry digest is invalid.');
  return image.digest;
}

/** Preparation publishes the one tested image under an immutable source name.
 * @param {string} cwd @param {string} image @param {string} commit @param {Record<string,unknown>} tested
 */
export async function publishPreparedImage(cwd, image, commit, tested) {
  if (typeof tested.id !== 'string' || tested.commit !== commit)
    throw new Error('The prepared image is missing.');
  const reference = `${image}:source-${commit}`;
  if (remoteImage(cwd, reference) === null) {
    command(cwd, 'docker', ['tag', tested.id, reference]);
    command(cwd, 'docker', ['push', reference]);
  }
  command(cwd, 'docker', ['pull', reference]);
  /** @type {unknown} */
  const inspection = JSON.parse(
    command(cwd, 'docker', ['image', 'inspect', reference]),
  );
  const item = Array.isArray(inspection) ? record(inspection[0]) : {};
  if (
    item.Id !== tested.id ||
    record(record(item.Config).Labels)['org.opencontainers.image.revision'] !==
      commit
  )
    throw new Error('The prepared image differs. Never replace it.');
  const imageDigest = remoteImage(cwd, reference);
  if (!imageDigest)
    throw new Error('The prepared image is absent after publication.');
  return `${image}@${imageDigest}`;
}

/** @param {string} version @param {string|null} publishedTag */
export function advancesLatest(version, publishedTag) {
  if (parseVersion(version) === null)
    throw new Error('The prepared version is invalid.');
  if (publishedTag === null) return true;
  const published = publishedTag.startsWith('v') ? publishedTag.slice(1) : '';
  if (parseVersion(published) === null)
    throw new Error('The latest published version is invalid.');
  return compareVersions(version, published) >= 0;
}

/** @param {string} cwd @param {string} repository */
function latestPublishedTag(cwd, repository) {
  const result = spawnSync(
    'gh',
    ['api', `repos/${repository}/releases/latest`, '--jq', '.tag_name'],
    { cwd, encoding: 'utf8' },
  );
  if (result.status === 0) return result.stdout.trim();
  if (/^gh: Not Found \(HTTP 404\)\s*$/m.test(result.stderr ?? '')) return null;
  throw new Error(
    'The latest release read is uncertain. No publication starts.',
  );
}

const publicationLockName = 'CORE_RELEASE_PUBLICATION_LOCK';

/** @param {string} cwd @param {string} repository */
function readPublicationLock(cwd, repository) {
  const result = spawnSync(
    'gh',
    ['api', `repos/${repository}/actions/variables/${publicationLockName}`],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    if (/^gh: Not Found \(HTTP 404\)\s*$/m.test(result.stderr ?? ''))
      return null;
    throw new Error(
      'The publication lock read is uncertain. No takeover is allowed.',
    );
  }
  const variable = record(JSON.parse(result.stdout));
  if (
    variable.name !== publicationLockName ||
    typeof variable.value !== 'string'
  )
    throw new Error('The publication lock has invalid inputs.');
  return variable.value;
}

/** Atomic creation excludes every other runner, including the same version.
 * @param {string} cwd @param {string} repository @param {string} version
 */
export function acquirePublicationLock(cwd, repository, version) {
  const owner = JSON.stringify({ run: randomUUID(), version });
  const result = spawnSync(
    'gh',
    [
      'api',
      `repos/${repository}/actions/variables`,
      '--method',
      'POST',
      '--raw-field',
      `name=${publicationLockName}`,
      '--raw-field',
      `value=${owner}`,
    ],
    { cwd, encoding: 'utf8' },
  );
  const observed = readPublicationLock(cwd, repository);
  if (observed !== owner)
    throw new Error(
      observed === null
        ? 'The publication lock creation is uncertain. No publication starts.'
        : 'Another publication holds the repository lock. Wait for that run or recover its stopped write.',
    );
  // Readback also handles a lost creation response. Never PATCH an owner.
  if (result.error)
    throw new Error(
      'The publication lock command stopped. Read its remote state before retry.',
    );
  return () => {
    if (readPublicationLock(cwd, repository) !== owner)
      throw new Error(
        'The publication lock owner changed. No lock is removed.',
      );
    spawnSync(
      'gh',
      [
        'api',
        `repos/${repository}/actions/variables/${publicationLockName}`,
        '--method',
        'DELETE',
      ],
      { cwd, encoding: 'utf8' },
    );
    if (readPublicationLock(cwd, repository) === owner)
      throw new Error(
        'The publication lock removal is uncertain. Read its remote state before retry.',
      );
  };
}

/** @typedef {{cwd:string;version?:string;execute?:boolean;resume?:boolean;status?:boolean;autoReviewOnReady?:boolean}} ReleaseOptions */
/** @param {ReleaseOptions} options */
export async function release(options) {
  const cwd = options.cwd;
  const version =
    options.version ??
    changelogEntries(readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8'))[0]
      ?.version;
  if (!version || parseVersion(version) === null)
    throw new Error('Select the prepared release version.');
  const unlock = lock(cwd, 'release');
  let releasePublicationLock;
  let publicationStarted = false;
  let publicationComplete = false;
  try {
    const repository = githubRepository(
      git(cwd, ['config', '--get', 'remote.origin.url']),
    );
    const tag = `v${version}`;
    const remote = publishedRelease(cwd, tag);
    if (!remote.release)
      throw new Error(
        'No prepared release exists. Run pnpm release:prepare first.',
      );
    const manifestBytes = remote.assets.get('release-manifest.json');
    const contractBytes = remote.assets.get('operator-contract.json');
    if (!manifestBytes || !contractBytes)
      throw new Error(
        'The prepared release is incomplete. Resume pnpm release:prepare.',
      );
    const manifest = parseManifest(JSON.parse(manifestBytes.toString('utf8')));
    const commit = manifest.source.commit;
    const image = manifest.image.reference;
    const imageDigest = manifest.image.digest;
    if (
      typeof commit !== 'string' ||
      typeof image !== 'string' ||
      typeof imageDigest !== 'string' ||
      manifest.repository !== repository ||
      manifest.version !== version ||
      manifest.tag !== tag ||
      image !== `ghcr.io/${repository.toLowerCase()}` ||
      digest(contractBytes) !== manifest.operator.contractDigest ||
      remote.release.name !== releaseTitle(version) ||
      remote.release.prerelease !== false ||
      typeof remote.release.draft !== 'boolean'
    )
      throw new Error('The prepared release identity differs.');
    const result = {
      phase: remote.release.draft ? 'ready' : 'complete',
      stage: remote.release.draft ? 'ready' : 'complete',
      selectedCommit: commit,
      version,
      image: `${image}@${imageDigest}`,
      manifest,
    };
    if (options.status || !options.execute) return result;
    command(cwd, 'git', ['fetch', '--quiet', 'origin', 'main', '--tags']);
    git(cwd, ['merge-base', '--is-ancestor', commit, 'origin/main']);
    releasePublicationLock = acquirePublicationLock(cwd, repository, version);
    const advanceLatest =
      remote.release.draft &&
      advancesLatest(version, latestPublishedTag(cwd, repository));
    const source = `${image}@${imageDigest}`;
    if (remoteImage(cwd, source) !== imageDigest)
      throw new Error('The prepared image is absent.');
    const fixed = remoteImage(cwd, `${image}:${version}`);
    if (fixed !== null && fixed !== imageDigest)
      throw new Error('The fixed image differs. Never replace it.');
    const local = git(cwd, ['tag', '--list', tag]);
    if (!local)
      git(cwd, ['tag', '-s', tag, '-m', releaseTitle(version), commit]);
    git(cwd, ['verify-tag', tag]);
    if (git(cwd, ['rev-parse', `${tag}^{commit}`]) !== commit)
      throw new Error('The fixed tag source differs. Never replace it.');
    const tagObject = git(cwd, ['rev-parse', tag]);
    const remoteTag = git(cwd, [
      'ls-remote',
      'origin',
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ]);
    if (remoteTag) {
      if (
        !remoteTag.split('\n').includes(`${tagObject}\trefs/tags/${tag}`) ||
        !remoteTag.split('\n').includes(`${commit}\trefs/tags/${tag}^{}`)
      )
        throw new Error('The remote tag differs. Never replace it.');
    } else {
      publicationStarted = true;
      git(cwd, ['push', 'origin', `refs/tags/${tag}`]);
    }
    for (const suffix of advanceLatest ? [version, 'latest'] : [version]) {
      const target = `${image}:${suffix}`;
      const current = remoteImage(cwd, target);
      if (current === imageDigest) continue;
      if (suffix === version && current !== null)
        throw new Error('The fixed image differs. Never replace it.');
      publicationStarted = true;
      command(cwd, 'docker', [
        'buildx',
        'imagetools',
        'create',
        '--prefer-index=false',
        '--tag',
        target,
        source,
      ]);
      if (remoteImage(cwd, target) !== imageDigest)
        throw new Error('The image tag write has no matching readback.');
    }
    if (remote.release.draft) {
      publicationStarted = true;
      command(cwd, 'gh', [
        'release',
        'edit',
        tag,
        '--draft=false',
        `--latest=${advanceLatest}`,
      ]);
    }
    const observed = publishedRelease(cwd, tag);
    if (
      observed.release?.draft !== false ||
      observed.release.tag_name !== tag ||
      observed.release.name !== remote.release.name ||
      observed.release.body !== remote.release.body ||
      !observed.assets.get('release-manifest.json')?.equals(manifestBytes) ||
      !observed.assets.get('operator-contract.json')?.equals(contractBytes)
    )
      throw new Error('The release write has no matching readback.');
    publicationComplete = true;
    return { ...result, phase: 'complete', stage: 'complete' };
  } finally {
    try {
      if (
        releasePublicationLock &&
        (publicationComplete || !publicationStarted)
      )
        releasePublicationLock();
    } finally {
      unlock();
    }
  }
}
