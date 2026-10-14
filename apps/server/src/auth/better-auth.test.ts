import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authProblemCode,
  resetPasswordLink,
  withoutSessionToken,
} from './better-auth.ts';

await test('a sign-in answer loses its session token', () => {
  const answer = {
    redirect: false,
    token: 'raw-session-token',
    user: { id: 'u1' },
  };
  assert.deepEqual(withoutSessionToken(answer), {
    redirect: false,
    user: { id: 'u1' },
  });
});

await test('a get-session answer loses the token inside the session', () => {
  const answer = {
    user: { id: 'u1', email: 'owner@example.test' },
    session: { id: 's1', expiresAt: '2026-01-01T00:00:00.000Z', token: 'raw' },
  };
  assert.deepEqual(withoutSessionToken(answer), {
    user: { id: 'u1', email: 'owner@example.test' },
    session: { id: 's1', expiresAt: '2026-01-01T00:00:00.000Z' },
  });
});

await test('an answer that carries the token twice loses both copies', () => {
  const answer = { token: 'raw', session: { id: 's1', token: 'raw' } };
  assert.deepEqual(withoutSessionToken(answer), { session: { id: 's1' } });
});

await test('an answer without a token is unchanged', () => {
  assert.deepEqual(withoutSessionToken({ status: true }), { status: true });
  assert.deepEqual(withoutSessionToken(null), null);
  assert.deepEqual(withoutSessionToken([1, 2]), [1, 2]);
  assert.deepEqual(withoutSessionToken('text'), 'text');
});

await test('a refusal of a sign-in names what the person can do', () => {
  assert.equal(
    authProblemCode(400, 'invalid_signature'),
    'oauth_request_invalid',
  );
  assert.equal(
    authProblemCode(403, 'EMAIL_NOT_VERIFIED'),
    'address_unverified',
  );
  assert.equal(
    authProblemCode(403, 'ACCOUNT_UNAVAILABLE'),
    'account_unavailable',
  );
  assert.equal(authProblemCode(403, null), 'forbidden');
  assert.equal(authProblemCode(400, 'PASSWORD_BREACHED'), 'password_breached');
});

await test('a reset link opens the application with the token in the fragment', () => {
  assert.equal(
    resetPasswordLink('https://notes.example.com', 'abc'),
    'https://notes.example.com/reset-password#abc',
  );
});
