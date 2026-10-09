/** Public immutable release metadata. No private checkout is required. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  operatorContractFiles,
  operatorSurfacePath,
} from './agent-context.mjs';
import { digest, git } from './lifecycle-state.mjs';
import { record } from './workspace.mjs';

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
