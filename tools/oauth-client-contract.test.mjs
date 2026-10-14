/** The client exception is the exact OAuth error set of the contract (0226). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/** @param {unknown} value */
function record(value) {
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  return Object.fromEntries(Object.entries(value));
}
test('the client path exception and error enum match the generated contract', async () => {
  const [source, contract] = await Promise.all([
    readFile(
      new URL('../packages/api-client/src/configure.ts', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL(
        '../packages/api-contract/src/generated/openapi.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);
  const prefix = /const oauthPathPrefix = '([^']+)';/.exec(source)?.[1];
  assert.equal(prefix, '/api/auth/oauth2/');
  const list = /export const oauthErrorCodes = \[([\s\S]*?)\] as const/.exec(
    source,
  )?.[1];
  assert.ok(list);
  const codes = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const document = record(JSON.parse(contract));
  const schemas = record(record(document.components).schemas);
  assert.deepEqual(
    record(record(record(schemas.OAuthError).properties).error).enum,
    codes,
  );
  for (const [path, item] of Object.entries(record(document.paths))) {
    for (const [method, operation] of Object.entries(record(item))) {
      if (
        !['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(
          method,
        )
      )
        continue;
      const errors = Object.entries(record(record(operation).responses)).filter(
        ([status]) => Number(status) >= 400,
      );
      const usesOAuth = errors.some(([, error]) =>
        JSON.stringify(error).includes('#/components/schemas/OAuthError'),
      );
      assert.equal(
        usesOAuth,
        path.startsWith(prefix ?? ''),
        `${method} ${path}`,
      );
    }
  }
});
