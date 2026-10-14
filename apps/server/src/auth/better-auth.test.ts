import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authProblemCode,
  oauthCreateRequested,
  oauthNormalizedPrompt,
  resetPasswordLink,
  withoutSessionToken,
} from './better-auth.ts';

await test('prompt normalization trims and deduplicates in first token order', () => {
  for (const [input, expected] of [
    ['\tlogin\t', 'login'],
    ['login\n', 'login'],
    ['\tlogin\t consent', 'login consent'],
    ['login login consent', 'login consent'],
    [' consent  login consent login ', 'consent login'],
    [' create login create consent login ', 'create login consent'],
    ['none none', 'none'],
    ['select_account select_account', 'select_account'],
    ['creates Create cre ate', 'creates Create cre ate'],
    ['login\tconsent', 'login\tconsent'],
    ['', undefined],
    [' \t \n ', undefined],
  ]) {
    assert.ok(typeof input === 'string');
    assert.equal(oauthNormalizedPrompt(input), expected);
  }
});

await test('the create refusal trims each space-separated prompt token', () => {
  const spaces = [
    ' ',
    '\t',
    '\n',
    '\r',
    '\v',
    '\f',
    '\u00a0',
    '\u1680',
    '\u2000',
    '\u2001',
    '\u2002',
    '\u2003',
    '\u2004',
    '\u2005',
    '\u2006',
    '\u2007',
    '\u2008',
    '\u2009',
    '\u200a',
    '\u2028',
    '\u2029',
    '\u202f',
    '\u205f',
    '\u3000',
    '\ufeff',
  ];
  for (const space of spaces) {
    for (const prompt of [
      `${space}create${space}`,
      `login ${space}create${space} consent`,
      `create${space}`,
    ])
      assert.equal(oauthCreateRequested(prompt), true, JSON.stringify(prompt));
  }
});

await test('the create refusal compares whole tokens with the same case', () => {
  for (const prompt of [
    'creates',
    'xcreate',
    'Create',
    'cre ate',
    '',
    'login consent',
    'login\tcreate',
    'create\nconsent',
    undefined,
    null,
    false,
    0,
    ['create'],
    { prompt: 'create' },
  ])
    assert.equal(oauthCreateRequested(prompt), false, JSON.stringify(prompt));
});

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
