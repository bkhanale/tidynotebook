import assert from 'node:assert/strict';
import test from 'node:test';
import { createVerificationTokens } from './verification.ts';

const secret = 'verification-test-secret-0123456789abcdef';
const now = new Date('2026-09-27T12:00:00.000Z');
const later = new Date('2026-09-28T12:00:00.000Z');

await test('a token names its identity user until it stops', () => {
  const tokens = createVerificationTokens(secret);
  const token = tokens.issue('user-abc', later);
  assert.match(token, /^[A-Za-z0-9_.-]+$/);
  assert.equal(tokens.read(token, now), 'user-abc');
  assert.equal(tokens.read(token, later), null);
});

await test('a forged, changed or foreign token names nobody', () => {
  const tokens = createVerificationTokens(secret);
  const token = tokens.issue('user-abc', later);
  const [version, , expiry, signature] = token.split('.');
  const other = Buffer.from('user-xyz').toString('base64url');
  assert.equal(
    tokens.read(`${version}.${other}.${expiry}.${signature}`, now),
    null,
  );
  assert.equal(
    tokens.read(
      token.replace(`.${expiry}.`, `.${String(Number(expiry) + 3600)}.`),
      now,
    ),
    null,
  );
  assert.equal(
    createVerificationTokens(`${secret}-other`).read(token, now),
    null,
  );
  for (const value of [
    '',
    'v1',
    'v1.a.b',
    `v2.${token.slice(3)}`,
    `${token}.x`,
  ])
    assert.equal(tokens.read(value, now), null, value);
});
