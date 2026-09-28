/**
 * Proves the shared schema dialect of the two contracts with the pinned lint.
 *
 * A message payload is read as an AsyncAPI 3.0 schema by the lint and as a
 * JSON Schema 2020-12 schema by Ajv, so it may use only the keywords that
 * both read the same way (record 0126). The test runs the pinned Redocly CLI
 * with the rules of `packages/api-contract/redocly.yaml` on a small message
 * contract. A payload of shared keywords passes, and a payload that uses a
 * 2020-12 keyword fails, directly and through a nested reference.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { redoclyBin, redoclyConfigFile } from './paths.ts';

const root = `asyncapi: 3.0.0
info:
  title: dialect
  version: 1.0.0
  description: dialect
  license:
    name: MIT
    url: https://spdx.org/licenses/MIT.html
channels:
  demo:
    address: /demo
    description: demo
    messages:
      demo:
        name: demo
        summary: demo
        payload:
          $ref: './Payload.yaml'
operations:
  sendDemo:
    action: send
    title: demo
    summary: demo
    description: demo
    channel:
      $ref: '#/channels/demo'
    security:
      - $ref: '#/components/securitySchemes/cookie'
    messages:
      - $ref: '#/channels/demo/messages/demo'
components:
  securitySchemes:
    cookie:
      type: httpApiKey
      in: cookie
      name: session
      description: demo
`;

/** Lints a message contract whose payload has the given members. */
async function lint(payload: string, nested = ''): Promise<number | null> {
  const directory = await mkdtemp(join(tmpdir(), 'notesapp-dialect-'));
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'asyncapi.yaml'), root, 'utf8');
    await writeFile(join(directory, 'Payload.yaml'), payload, 'utf8');
    if (nested !== '')
      await writeFile(join(directory, 'Nested.yaml'), nested, 'utf8');
    const run = spawnSync(
      redoclyBin,
      ['lint', '--config', redoclyConfigFile, 'asyncapi.yaml'],
      { cwd: directory, encoding: 'utf8' },
    );
    return run.status;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const shared = `type: object
additionalProperties: false
required: [kind]
properties:
  kind:
    type: string
    const: demo
  ids:
    type: array
    maxItems: 3
    uniqueItems: true
    items:
      type: string
      pattern: ^[a-z]+$
`;

await test('a payload of shared keywords passes the lint', async () => {
  assert.equal(await lint(shared), 0);
});

await test('a 2020-12 keyword in a payload fails the lint', async () => {
  assert.equal(
    await lint(`type: array
prefixItems:
  - type: string
`),
    1,
  );
});

await test('a 2020-12 keyword behind a reference fails the lint', async () => {
  assert.equal(
    await lint(
      `type: object
properties:
  list:
    $ref: './Nested.yaml'
`,
      `type: array
unevaluatedItems: false
`,
    ),
    1,
  );
});
