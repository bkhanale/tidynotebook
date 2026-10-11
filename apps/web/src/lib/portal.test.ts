import assert from 'node:assert/strict';
import test from 'node:test';
import {
  portalAddress,
  portalHome,
  portalPath,
  portalPathOf,
  portalRoute,
  portalStep,
} from './portal.ts';
import { returnOf, signInRoute } from './sign-in-return.ts';

await test('a portal path that the contract takes passes', () => {
  assert.equal(portalPath('/'), '/');
  assert.equal(portalPath('/profile'), '/profile');
  assert.equal(portalPath('/members/join/'), '/members/join/');
  assert.equal(portalPath('/a.b~c_d-e'), '/a.b~c_d-e');
});

await test('any other path opens the root of the portal', () => {
  for (const value of [
    null,
    '',
    'profile',
    '//evil.example',
    '/a//b',
    '/../admin',
    '/.hidden',
    '/profile?x=1',
    '/profile#top',
    '/profile%2F',
    '/ space',
    'https://evil.example/',
    `/${'a'.repeat(256)}`,
  ])
    assert.equal(portalPath(value), portalHome, String(value));
});

await test('the route reads the path from its query', () => {
  assert.equal(portalPathOf('?path=%2Fmembers%2Fjoin'), '/members/join');
  assert.equal(portalPathOf('?path=/profile'), '/profile');
  assert.equal(portalPathOf('?path=//evil.example'), '/');
  assert.equal(portalPathOf(''), '/');
});

await test('the address of the route carries a valid path only', () => {
  assert.equal(portalAddress('/profile'), `${portalRoute}?path=%2Fprofile`);
  assert.equal(portalAddress('//evil.example'), `${portalRoute}?path=%2F`);
  assert.equal(
    portalPathOf(portalAddress('/members/join').slice(portalRoute.length)),
    '/members/join',
  );
});

await test('a session that loads waits', () => {
  assert.deepEqual(
    portalStep({ status: 'loading', account: null }, '?path=/profile'),
    { kind: 'wait' },
  );
});

await test('no session goes to sign-in and comes back to the same path', () => {
  const step = portalStep(
    { status: 'signed-out', account: null },
    '?path=/members/join',
  );
  assert.equal(step.kind, 'sign-in');
  if (step.kind !== 'sign-in') return;
  assert.ok(step.address.startsWith(`${signInRoute}?`));
  assert.equal(
    returnOf(step.address.slice(signInRoute.length)),
    portalAddress('/members/join'),
  );
});

await test('an installation with no portal says so', () => {
  assert.deepEqual(
    portalStep(
      { status: 'signed-in', account: { accountPortal: false } },
      '?path=/profile',
    ),
    { kind: 'no-portal' },
  );
});

await test('an account opens the path of the portal that the link names', () => {
  assert.deepEqual(
    portalStep(
      { status: 'signed-in', account: { accountPortal: true } },
      '?path=/profile',
    ),
    { kind: 'open', path: '/profile' },
  );
  assert.deepEqual(
    portalStep(
      { status: 'signed-in', account: { accountPortal: true } },
      '?path=//evil.example',
    ),
    { kind: 'open', path: '/' },
  );
});
