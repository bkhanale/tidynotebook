/** Publish only the image archives that passed native compliance. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { image, repository, versionFromRef } from './release-workflow.mjs';
import { record } from './workspace.mjs';

/** @param {string[]} args */
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
const version = versionFromRef(process.env.GITHUB_REF ?? '');
assert.equal(version, process.env.VERSION);
assert.equal(process.env.GITHUB_REPOSITORY, repository);
const sha = process.env.SOURCE_SHA ?? '';
assert.match(sha, /^[a-f0-9]{40}$/);
assert.ok(process.env.RUNNER_TEMP);

const packagePath = image.slice('ghcr.io/'.length);
const [packageOwner, packageName] = packagePath.split('/');
const access = await fetch(
  `https://api.github.com/orgs/${packageOwner}/packages/container/${packageName}`,
  {
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  },
);
assert.equal(access.status, 200, 'Cannot read image package access.');
const packageAccess = record(await access.json());
assert.equal(
  packageAccess.visibility,
  'public',
  'The image package must be public.',
);
assert.equal(
  record(packageAccess.repository).full_name,
  repository,
  'The image package must be linked to this repository.',
);

// A failed registry read is not proof that a fixed tag is free.
if (version !== 'main') {
  const authorization = Buffer.from(
    `${process.env.GITHUB_ACTOR}:${process.env.GH_TOKEN}`,
  ).toString('base64');
  const reply = await fetch(
    `https://ghcr.io/token?service=ghcr.io&scope=repository:${packagePath}:pull`,
    {
      headers: { authorization: `Basic ${authorization}` },
    },
  );
  assert.equal(reply.status, 200, 'Cannot read registry access.');
  const token = record(await reply.json()).token;
  assert.equal(typeof token, 'string');
  const manifest = await fetch(
    `https://ghcr.io/v2/${packagePath}/manifests/${version}`,
    {
      headers: {
        authorization: `Bearer ${String(token)}`,
        accept:
          'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
      },
    },
  );
  assert.equal(
    manifest.status,
    404,
    'The version exists or registry access failed. Fixed versions cannot be replaced.',
  );
  const errors = record(await manifest.json()).errors;
  assert.ok(
    Array.isArray(errors) &&
      errors.length > 0 &&
      errors.every((error) =>
        ['MANIFEST_UNKNOWN', 'NAME_UNKNOWN'].includes(
          String(record(error).code),
        ),
      ),
    'Registry tag absence is not proved.',
  );
}

/** @type {string[]} */
const sources = [];
/** @type {Map<string, {labels: Record<string, unknown>, diffIds: string[]}>} */
const tested = new Map();
for (const arch of ['amd64', 'arm64']) {
  docker([
    'load',
    '--input',
    join(process.env.RUNNER_TEMP, 'core-images', `image-${arch}.tar`),
  ]);
  /** @type {unknown} */
  const raw = JSON.parse(docker(['image', 'inspect', `notesapp:${arch}`]));
  assert.ok(Array.isArray(raw) && raw.length === 1);
  const local = record(raw[0]);
  assert.equal(local.Os, 'linux');
  assert.equal(local.Architecture, arch);
  const labels = record(record(local.Config).Labels);
  assert.equal(labels['org.opencontainers.image.revision'], sha);
  assert.equal(
    labels['org.opencontainers.image.source'],
    `https://github.com/${repository}`,
  );
  assert.equal(labels['org.opencontainers.image.version'], version);
  const layers = record(local.RootFS).Layers;
  assert.ok(Array.isArray(layers));
  const diffIds = layers.map((layer) => {
    assert.ok(typeof layer === 'string');
    return layer;
  });
  tested.set(arch, { labels, diffIds });
}
// Conversion serializes a new OCI config and recompresses layers. Check the
// tested labels and uncompressed layer digests before any registry copy.
// Preserve the resulting OCI manifest digest during the registry copy.
for (const arch of ['amd64', 'arm64']) {
  const layout = `oci:${join(process.env.RUNNER_TEMP, `oci-${arch}`)}:proved`;
  execFileSync(
    'skopeo',
    [
      'copy',
      '--format',
      'oci',
      `docker-archive:${join(process.env.RUNNER_TEMP, 'core-images', `image-${arch}.tar`)}`,
      layout,
    ],
    { stdio: 'inherit' },
  );
  const converted = record(
    JSON.parse(
      execFileSync('skopeo', ['inspect', '--config', layout], {
        encoding: 'utf8',
      }),
    ),
  );
  const expected = tested.get(arch);
  assert.ok(expected);
  assert.deepEqual(
    record(converted.rootfs).diff_ids,
    expected.diffIds,
    'Conversion changed the tested filesystem layer digests.',
  );
  assert.deepEqual(
    record(converted.config).Labels,
    expected.labels,
    'Conversion changed the tested image labels.',
  );
  const manifest = execFileSync('skopeo', ['inspect', '--raw', layout]);
  const digest = `sha256:${createHash('sha256').update(manifest).digest('hex')}`;
  sources.push(`${image}@${digest}`);
}
for (const [index, arch] of ['amd64', 'arm64'].entries()) {
  const source = sources[index];
  assert.ok(source);
  execFileSync(
    'skopeo',
    [
      'copy',
      '--preserve-digests',
      '--authfile',
      join(
        process.env.DOCKER_CONFIG ?? join(homedir(), '.docker'),
        'config.json',
      ),
      `oci:${join(process.env.RUNNER_TEMP, `oci-${arch}`)}:proved`,
      `docker://${source}`,
    ],
    { stdio: 'inherit' },
  );
}
// A queued run must not move main back after a later merge.
if (version === 'main') {
  const current = execFileSync(
    'gh',
    ['api', `repos/${repository}/commits/main`, '--jq', '.sha'],
    { encoding: 'utf8' },
  ).trim();
  assert.equal(current, sha, 'A newer main commit exists.');
}
docker([
  'buildx',
  'imagetools',
  'create',
  '--tag',
  `${image}:${version}`,
  ...sources,
]);
const digest = docker([
  'buildx',
  'imagetools',
  'inspect',
  `${image}:${version}`,
  '--format',
  '{{.Manifest.Digest}}',
]).trim();
assert.match(digest, /^sha256:[a-f0-9]{64}$/);
const index = record(
  JSON.parse(
    docker(['buildx', 'imagetools', 'inspect', `${image}@${digest}`, '--raw']),
  ),
);
assert.ok(Array.isArray(index.manifests));
assert.deepEqual(
  index.manifests
    .map((child) => {
      const childDigest = record(child).digest;
      assert.ok(typeof childDigest === 'string');
      return childDigest;
    })
    .sort((a, b) => a.localeCompare(b)),
  sources
    .map((source) => source.slice(image.length + 1))
    .sort((a, b) => a.localeCompare(b)),
  'The published index must contain exactly the pushed image digests.',
);
assert.ok(process.env.GITHUB_OUTPUT);
appendFileSync(process.env.GITHUB_OUTPUT, `digest=${digest}\n`);
assert.ok(process.env.GITHUB_STEP_SUMMARY);
appendFileSync(
  process.env.GITHUB_STEP_SUMMARY,
  `Core source: \`${sha}\`\n\nImage: \`${image}@${digest}\`\n\nTag: \`${version}\`\n`,
);
