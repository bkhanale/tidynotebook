import assert from 'node:assert/strict';
import test from 'node:test';
import { isApiKeySecret, newApiKeySecret } from './api-key-secrets.ts';
await test('personal secrets carry 256 random bits and a distinct prefix', () => {
  const first = newApiKeySecret();
  const second = newApiKeySecret();
  assert.equal(isApiKeySecret(first), true);
  assert.equal(Buffer.from(first.slice(4), 'base64url').length, 32);
  assert.notEqual(first, second);
  for (const invalid of [
    '',
    first.slice(1),
    `${first}x`,
    first.replace('tnk_', 'pub_'),
    `tnk_${'a'.repeat(42)}`,
    `tnk_${'a'.repeat(42)} `,
  ])
    assert.equal(isApiKeySecret(invalid), false);
});
