/** Public immutable release metadata. No private checkout is required. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  operatorContractFiles,
  operatorSurfacePath,
} from './agent-context.mjs';
import { command, digest, git, snapshot } from './lifecycle-state.mjs';
import { record } from './workspace.mjs';
import { githubRepository } from './pr-screenshots.mjs';

/** @param {string} cwd */
export async function operatorDigests(cwd) {
  const contract = await operatorContractFiles(cwd);
  const files = git(cwd, ['ls-files', '-z']).split('\0').filter(Boolean);
  /** @param {string[]} names */
  const hash = (names) =>
    digest(
      Buffer.concat(
        names
          .sort()
          .map((file) =>
            Buffer.concat([
              Buffer.from(file + '\0'),
              readFileSync(join(cwd, file)),
              Buffer.from('\0'),
            ]),
          ),
      ),
    );
  return {
    contractDigest: hash([...contract]),
    surfaceDigest: hash(
      files.filter((file) => operatorSurfacePath(file) || contract.has(file)),
    ),
  };
}
/** @param {string} cwd */
export function migrationMetadata(cwd) {
  const source = readFileSync(
    join(cwd, 'packages/storage-server/src/migrate.ts'),
    'utf8',
  );
  const version = /export const requiredSchemaVersion = (\d+);/.exec(
    source,
  )?.[1];
  const journal = record(
    JSON.parse(
      readFileSync(
        join(cwd, 'packages/storage-server/migrations/meta/_journal.json'),
        'utf8',
      ),
    ),
  );
  if (
    !version ||
    !Array.isArray(journal.entries) ||
    journal.entries.length !== Number(version)
  )
    throw new Error('The migration requirement and journal differ.');
  const files = git(cwd, [
    'ls-files',
    '-z',
    'packages/storage-server/migrations',
    'packages/storage-server/src/migrate.ts',
  ])
    .split('\0')
    .filter(Boolean);
  return {
    requiredSchemaVersion: Number(version),
    digest: digest(
      Buffer.concat(
        files
          .sort()
          .map((path) =>
            Buffer.concat([
              Buffer.from(path + '\0'),
              readFileSync(join(cwd, path)),
            ]),
          ),
      ),
    ),
  };
}

/** @param {unknown} value */
export function parseManifest(value) {
  const root = record(value),
    source = record(root.source),
    image = record(root.image),
    operator = record(root.operator),
    verification = record(root.verification),
    migration = record(root.migration);
  /** @param {unknown} value @param {RegExp} pattern */
  const matches = (value, pattern) =>
    typeof value === 'string' && pattern.test(value);
  if (
    root.schemaVersion !== 1 ||
    !Number.isSafeInteger(migration.requiredSchemaVersion) ||
    typeof migration.requiredSchemaVersion !== 'number' ||
    migration.requiredSchemaVersion < 0 ||
    !matches(migration.digest, /^sha256:[a-f0-9]{64}$/) ||
    !matches(root.repository, /^[\w.-]+\/[\w.-]+$/) ||
    !matches(root.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/) ||
    root.tag !== `v${root.version}` ||
    !matches(source.commit, /^[a-f0-9]{40}$/) ||
    !matches(source.tree, /^[a-f0-9]{40}$/) ||
    !matches(image.reference, /^[a-z0-9][a-z0-9./_-]+$/) ||
    !matches(image.digest, /^sha256:[a-f0-9]{64}$/) ||
    !matches(operator.contractDigest, /^sha256:[a-f0-9]{64}$/) ||
    !matches(operator.surfaceDigest, /^sha256:[a-f0-9]{64}$/) ||
    verification.commit !== source.commit ||
    !matches(verification.inputDigest, /^sha256:[a-f0-9]{64}$/) ||
    !matches(verification.toolDigest, /^sha256:[a-f0-9]{64}$/) ||
    !matches(verification.runtime, /^v\d+\.\d+\.\d+$/) ||
    !Array.isArray(verification.gates) ||
    !['verify', 'test:image'].every(
      (gate) =>
        Array.isArray(verification.gates) && verification.gates.includes(gate),
    )
  )
    throw new Error('The release manifest is invalid.');
  return {
    schemaVersion: 1,
    repository: root.repository,
    version: root.version,
    tag: root.tag,
    source,
    image,
    operator,
    migration,
    verification,
  };
}

/** The CLI enforces source identity from the signed certificate.
 * @param {string} repository @param {string} source @param {string} tag @param {string} image
 */
export function attestationArguments(repository, source, tag, image) {
  return [
    'attestation',
    'verify',
    `oci://${image}`,
    '--repo',
    repository,
    '--signer-workflow',
    `${repository}/.github/workflows/release.yml`,
    '--source-digest',
    source,
    '--source-ref',
    `refs/tags/${tag}`,
  ];
}
/** Refuse unsupported verification before any release write. @param {string} cwd */
export function releasePreflight(cwd) {
  let help;
  try {
    help = command(cwd, 'gh', ['attestation', 'verify', '--help']);
  } catch {
    throw new Error(
      'GitHub CLI needs attestation verify support before release.',
    );
  }
  if (
    !['--repo', '--signer-workflow', '--source-digest', '--source-ref'].every(
      (flag) => help.includes(flag),
    )
  )
    throw new Error(
      'GitHub CLI needs all attestation source policy flags before release.',
    );
}
/** Bundle the operator contract from the fixed source. @param {string} cwd @param {string} file */
export function generateOperatorContract(cwd, file) {
  command(cwd, join(cwd, 'tools/sdk-codegen/node_modules/.bin/redocly'), [
    'bundle',
    'packages/api-contract/openapi.yaml',
    '--config',
    'packages/api-contract/redocly.yaml',
    '--dereferenced',
    '--output',
    file,
  ]);
  const bundled = record(JSON.parse(readFileSync(file, 'utf8')));
  const paths = Object.fromEntries(
    Object.entries(record(bundled.paths)).flatMap(([path, value]) => {
      const operations = Object.fromEntries(
        Object.entries(record(value)).filter(([, operation]) => {
          const item = record(operation);
          return (
            (Array.isArray(item.tags) && item.tags.includes('operator')) ||
            item.operationId === 'openAccountPortal'
          );
        }),
      );
      return Object.keys(operations).length ? [[path, operations]] : [];
    }),
  );
  writeFileSync(
    file,
    JSON.stringify(
      {
        openapi: bundled.openapi,
        info: bundled.info,
        paths,
        components: {
          securitySchemes: record(bundled.components).securitySchemes,
        },
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
}
/** Build the one manifest shape for publication and readback.
 * @param {string} cwd @param {string} repository @param {string} version @param {string} imageReference
 * @param {string} imageDigest @param {string} contractFile @param {Record<string,unknown>} proof
 */
export async function createReleaseManifest(
  cwd,
  repository,
  version,
  imageReference,
  imageDigest,
  contractFile,
  proof,
) {
  const input = snapshot(cwd);
  return parseManifest({
    schemaVersion: 1,
    repository,
    version,
    tag: `v${version}`,
    source: { commit: input.commit, tree: input.tree },
    image: { reference: imageReference, digest: imageDigest },
    operator: {
      ...(await operatorDigests(cwd)),
      contractDigest: digest(readFileSync(contractFile)),
    },
    migration: migrationMetadata(cwd),
    verification: {
      commit: input.commit,
      inputDigest: proof.inputDigest,
      gates: proof.gates,
      runtime: proof.runtime,
      toolDigest: proof.toolDigest,
    },
  });
}
/** Read the published release and complete raw asset bytes. A read has no write effects.
 * @param {string} cwd @param {string} tag
 */
export function publishedRelease(cwd, tag) {
  const repository = githubRepository(
    git(cwd, ['config', '--get', 'remote.origin.url']),
  );
  let release;
  try {
    release = record(
      JSON.parse(
        command(cwd, 'gh', [
          'api',
          `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
        ]),
      ),
    );
  } catch (error) {
    const stderr = record(error).stderr;
    const message =
      typeof stderr === 'string'
        ? stderr
        : Buffer.isBuffer(stderr)
          ? stderr.toString('utf8')
          : '';
    if (!/^gh: Not Found \(HTTP 404\)\s*$/m.test(message)) throw error;
  }
  if (release && release.tag_name !== tag)
    throw new Error('The published release tag differs.');
  const assets = new Map();
  if (release) {
    if (!Array.isArray(release.assets))
      throw new Error('The release asset list is missing.');
    for (const asset of release.assets.map(record)) {
      if (
        !['release-manifest.json', 'operator-contract.json'].includes(
          String(asset.name),
        )
      )
        continue;
      if (
        typeof asset.name !== 'string' ||
        typeof asset.url !== 'string' ||
        assets.has(asset.name) ||
        asset.url !==
          `https://api.github.com/repos/${repository}/releases/assets/${asset.id}` ||
        typeof asset.id !== 'number'
      )
        throw new Error('The release asset identity is invalid.');
      const bytes = execFileSync(
        'gh',
        ['api', asset.url, '-H', 'Accept: application/octet-stream'],
        { cwd, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      assets.set(asset.name, bytes);
    }
  }
  return { release, assets };
}
/** Exact bytes prevent a partial or changed upload from permitting the next write.
 * @param {Map<string,Buffer>} assets @param {Record<string,string>} files
 */
export function checkReleaseAssets(assets, files) {
  for (const [name, file] of Object.entries(files)) {
    const bytes = assets.get(name);
    if (!bytes)
      throw new Error(
        'The published release asset is missing. Read publication before recovery.',
      );
    if (!bytes.equals(readFileSync(file)))
      throw new Error('The published release asset differs.');
  }
}
