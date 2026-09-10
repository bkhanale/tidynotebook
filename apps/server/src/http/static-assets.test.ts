import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptedEncodings,
  cacheControlFor,
  isHashedAssetName,
  matchesEntityTag,
  mimeTypeFor,
} from './static-assets.ts';

await test('brotli is preferred over gzip whatever the header order', () => {
  assert.deepEqual(acceptedEncodings('gzip, br'), ['br', 'gzip']);
  assert.deepEqual(acceptedEncodings('br;q=1.0, gzip;q=0.8'), ['br', 'gzip']);
  assert.deepEqual(acceptedEncodings('gzip, deflate'), ['gzip']);
  assert.deepEqual(acceptedEncodings('*'), ['br', 'gzip']);
});

await test('a refused encoding is not served', () => {
  assert.deepEqual(acceptedEncodings('br;q=0, gzip'), ['gzip']);
  assert.deepEqual(acceptedEncodings('identity'), []);
  assert.deepEqual(acceptedEncodings(''), []);
  assert.deepEqual(acceptedEncodings(undefined), []);
});

await test('a hashed file is cached for a year and everything else is not', () => {
  assert.ok(isHashedAssetName('/dist/assets/main-CdE12fGh.js'));
  assert.equal(
    cacheControlFor('/dist/assets/main-CdE12fGh.js'),
    'public, max-age=31536000, immutable',
  );
  assert.equal(cacheControlFor('/dist/index.html'), 'no-cache');
  assert.equal(cacheControlFor('/dist/service-worker.js'), 'no-cache');
  assert.equal(cacheControlFor('/dist/manifest.webmanifest'), 'no-cache');
  assert.equal(cacheControlFor('/dist/icon.svg'), 'no-cache');
  // A hashed document is still revalidated: the shell must never be pinned.
  assert.equal(cacheControlFor('/dist/frame-CdE12fGh.html'), 'no-cache');
});

await test('an entity tag condition matches by value and by star', () => {
  assert.ok(matchesEntityTag('"abc"', '"abc"'));
  assert.ok(matchesEntityTag('W/"abc"', '"abc"'));
  assert.ok(matchesEntityTag('"other", "abc"', '"abc"'));
  assert.ok(matchesEntityTag('*', '"abc"'));
  assert.equal(matchesEntityTag('"other"', '"abc"'), false);
  assert.equal(matchesEntityTag(undefined, '"abc"'), false);
});

await test('a built file keeps its declared content type', () => {
  assert.equal(mimeTypeFor('/dist/index.html'), 'text/html; charset=utf-8');
  assert.equal(
    mimeTypeFor('/dist/main.js'),
    'application/javascript; charset=utf-8',
  );
  assert.equal(mimeTypeFor('/dist/main.css'), 'text/css; charset=utf-8');
  assert.equal(
    mimeTypeFor('/dist/manifest.webmanifest'),
    'application/manifest+json; charset=utf-8',
  );
  assert.equal(mimeTypeFor('/dist/icon.svg'), 'image/svg+xml');
  assert.equal(mimeTypeFor('/dist/unknown.bin'), 'application/octet-stream');
});
