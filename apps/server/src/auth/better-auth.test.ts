import assert from 'node:assert/strict';
import test from 'node:test';
import { withoutSessionToken } from './better-auth.ts';

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
