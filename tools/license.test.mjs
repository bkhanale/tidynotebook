import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';
import { readJson, root, workspaces } from './workspace.mjs';

// Record 0188: the repository is under AGPL-3.0-only. `LICENSE` holds the
// text, and every manifest and contract states the same license.

/** The SPDX identifier of the license of this repository. */
const license = 'AGPL-3.0-only';

/**
 * The SHA-256 digest of the text at https://www.gnu.org/licenses/agpl-3.0.txt.
 * A change of one byte of `LICENSE` changes it.
 */
const agplDigest =
  '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0';

await test('LICENSE holds the exact text of the GNU AGPL version 3', async () => {
  const text = await readFile(join(root, 'LICENSE'), 'utf8');
  assert.match(text, /^\s+GNU AFFERO GENERAL PUBLIC LICENSE\n/);
  assert.match(text, /\n\s+Version 3, 19 November 2007\n/);
  assert.equal(createHash('sha256').update(text).digest('hex'), agplDigest);
});

await test('each package.json states the license of LICENSE', async () => {
  const manifests = [
    { path: root, manifest: await readJson(join(root, 'package.json')) },
    ...(await workspaces()),
  ];
  assert.ok(manifests.length > 1, 'no workspace package is found');
  for (const { path, manifest } of manifests)
    assert.equal(
      manifest.license,
      license,
      `${relative(root, join(path, 'package.json'))} states another license`,
    );
});

await test('the contracts state the license of LICENSE', async () => {
  const openapi = await readFile(
    join(root, 'packages/api-contract/openapi.yaml'),
    'utf8',
  );
  assert.match(
    openapi,
    new RegExp(
      `\\n  license:\\n    name: ${license}\\n    identifier: ${license}\\n`,
    ),
  );
  const asyncapi = await readFile(
    join(root, 'packages/api-contract/asyncapi.yaml'),
    'utf8',
  );
  assert.match(
    asyncapi,
    new RegExp(
      `\\n  license:\\n    name: ${license}\\n    url: https://spdx\\.org/licenses/${license}\\.html\\n`,
    ),
  );
});
