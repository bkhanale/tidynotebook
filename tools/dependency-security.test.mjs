import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { record, root } from './workspace.mjs';

/** Check the exports before the test calls an installed dependency.
 * @param {unknown} value
 * @returns {value is {default: (source: string, options: {imports: Record<string, unknown>}) => (data: Record<string, unknown>) => string}} */
function templateModule(value) {
  return typeof record(value).default === 'function';
}

/** Check the parser before the test calls an installed dependency.
 * @param {unknown} value
 * @returns {value is {load: (source: string, options?: {maxTotalMergeKeys: number}) => unknown}} */
function yamlModule(value) {
  return typeof record(value).load === 'function';
}

await test('the diagram dependency refuses executable template import names', async () => {
  const web = createRequire(join(root, 'apps/web/package.json'));
  const mermaid = createRequire(web.resolve('mermaid'));
  const parser = createRequire(mermaid.resolve('chevrotain'));
  /** @type {unknown} */
  const lodash = parser('lodash-es/template.js');
  assert.ok(templateModule(lodash));
  const template = lodash.default;
  assert.equal(typeof template, 'function');
  assert.throws(
    () => template('', { imports: { 'untrusted = 1': undefined } }),
    /Invalid.*imports/,
  );
  assert.equal(
    template('<%= name %>', { imports: { name: 'Note' } })({}),
    'Note',
  );
});

await test('the contract parser counts empty sources toward the YAML merge budget', async () => {
  const generator = await realpath(
    join(
      root,
      'tools/sdk-codegen/node_modules/@hey-api/openapi-ts/package.json',
    ),
  );
  const parser = await realpath(
    join(dirname(generator), '../json-schema-ref-parser/package.json'),
  );
  /** @type {unknown} */
  const yaml = createRequire(parser)('js-yaml');
  assert.ok(yamlModule(yaml));
  const source =
    'base: &base {}\nmerged:\n  <<: [*base, *base, *base, *base]\n';
  assert.throws(() => yaml.load(source, { maxTotalMergeKeys: 1 }), /merge/i);
  assert.deepEqual(yaml.load('name: Note\n'), { name: 'Note' });
});
