/** Publish remote prepared artifacts. No source gate or local receipt is read. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogEntries } from './release-notes.mjs';
import { parseManifest, publishedRelease } from './release-manifest.mjs';
import { command, digest, git, lock } from './lifecycle-state.mjs';
import { githubRepository } from './pr-screenshots.mjs';
import { record } from './workspace.mjs';
import { parseVersion, releaseTitle } from './release-check.mjs';

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
    } else git(cwd, ['push', 'origin', `refs/tags/${tag}`]);
    for (const suffix of remote.release.draft
      ? [version, 'latest']
      : [version]) {
      const target = `${image}:${suffix}`;
      const current = remoteImage(cwd, target);
      if (current === imageDigest) continue;
      if (suffix === version && current !== null)
        throw new Error('The fixed image differs. Never replace it.');
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
    if (remote.release.draft)
      command(cwd, 'gh', ['release', 'edit', tag, '--draft=false']);
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
    return { ...result, phase: 'complete', stage: 'complete' };
  } finally {
    unlock();
  }
}
