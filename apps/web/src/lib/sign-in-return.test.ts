import assert from 'node:assert/strict';
import test from 'node:test';
import {
  returnAddress,
  returnOf,
  signInAddress,
  signInRoute,
} from './sign-in-return.ts';

await test('a path of this origin is where sign-in goes back to', () => {
  assert.equal(
    returnAddress('/portal?path=%2Fprofile'),
    '/portal?path=%2Fprofile',
  );
  assert.equal(
    returnAddress('/w/abc/settings#account'),
    '/w/abc/settings#account',
  );
  assert.equal(returnAddress('/%2F%2Fevil.example'), '/%2F%2Fevil.example');
  assert.equal(returnAddress('/'), '/');
});

await test('no return goes to the root', () => {
  assert.equal(returnAddress(null), '/');
  assert.equal(returnAddress(''), '/');
});

await test('both OAuth pages keep a long signed query through sign-in', () => {
  const values = {
    client_id: 'https://client.example/metadata.json',
    state: 'a+b & c'.repeat(200),
    sig: 'signed-value',
    exp: '1234567890',
  };
  const query = Object.entries(values)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
  for (const path of ['/oauth/sign-in', '/oauth/consent']) {
    const back = `${path}?${query}`;
    const login = signInAddress(back);
    assert.equal(returnAddress(back), back);
    assert.equal(returnOf(login.slice('/login'.length)), back);
  }
});

await test('a return that names another host or a scheme goes to the root', () => {
  // `tests/integration/web-delivery.test.ts` reads the same values through
  // the URL standard of Node.
  for (const value of [
    'https://evil.example/',
    'http://evil.example',
    '//evil.example',
    '//evil.example/portal',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '\\/evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    'javascript:alert(1)',
    'data:text/html,hi',
    'portal',
    ' /portal',
  ])
    assert.equal(returnAddress(value), '/', JSON.stringify(value));
  // A browser drops a control character, so the path that it reads is not
  // the path that this rule read.
  assert.equal(returnAddress('/a\tb'), '/');
});

await test('a return to sign-in itself goes to the root, so it never loops', () => {
  assert.equal(returnAddress('/login'), '/');
  assert.equal(returnAddress('/login?next=%2Flogin'), '/');
  assert.equal(returnAddress('/login/'), '/');
  assert.equal(returnAddress('/loginx'), '/loginx');
});

await test('the sign-in address carries the return and reads it back', () => {
  const address = signInAddress('/portal?path=/members/join');
  assert.ok(address.startsWith(`${signInRoute}?`));
  assert.equal(
    returnOf(address.slice(signInRoute.length)),
    '/portal?path=/members/join',
  );
  assert.equal(signInAddress('/'), signInRoute);
  assert.equal(signInAddress('//evil.example'), signInRoute);
  assert.equal(returnOf('?next=%2F%2Fevil.example'), '/');
  assert.equal(returnOf('?next=https%3A%2F%2Fevil.example'), '/');
  assert.equal(returnOf(''), '/');
});
