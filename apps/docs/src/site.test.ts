import assert from 'node:assert/strict';
import test from 'node:test';
import { absoluteAddress, readSiteSettings } from './site.ts';

await test('an empty environment serves the site at the root', () => {
  assert.deepEqual(readSiteSettings({}), { base: '/', origin: null });
});

await test('a base gains its two slashes once', () => {
  for (const value of ['notesapp', '/notesapp', '/notesapp/', ' notesapp/ '])
    assert.equal(
      readSiteSettings({ NOTESAPP_DOCS_BASE: value }).base,
      '/notesapp/',
    );
  assert.equal(
    readSiteSettings({ NOTESAPP_DOCS_BASE: '/docs/notesapp' }).base,
    '/docs/notesapp/',
  );
});

await test('a base that leaves its folder or holds a query is refused', () => {
  for (const value of ['/../etc/', '/a?b/', '/a b/', '/./'])
    assert.throws(
      () => readSiteSettings({ NOTESAPP_DOCS_BASE: value }),
      /NOTESAPP_DOCS_BASE must be a path/,
    );
});

await test('an origin is https, or http on the loopback host', () => {
  assert.equal(
    readSiteSettings({ NOTESAPP_DOCS_ORIGIN: 'https://docs.bhu.sh' }).origin,
    'https://docs.bhu.sh',
  );
  assert.equal(
    readSiteSettings({ NOTESAPP_DOCS_ORIGIN: 'http://localhost:4321/' }).origin,
    'http://localhost:4321',
  );
  for (const value of [
    'http://docs.example.com',
    'https://docs.example.com/notesapp',
    'https://docs.example.com/?a=1',
    'docs.example.com',
    'https://user@docs.example.com',
  ])
    assert.throws(
      () => readSiteSettings({ NOTESAPP_DOCS_ORIGIN: value }),
      /NOTESAPP_DOCS_ORIGIN must be/,
    );
});

await test('an address is in full only when the origin is known', () => {
  assert.equal(
    absoluteAddress({ base: '/', origin: null }, '/llms.txt'),
    '/llms.txt',
  );
  assert.equal(
    absoluteAddress(
      { base: '/notesapp/', origin: 'https://docs.bhu.sh' },
      '/notesapp/llms.txt',
    ),
    'https://docs.bhu.sh/notesapp/llms.txt',
  );
});
