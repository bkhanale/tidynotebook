import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishedOriginDecision,
  publishedOriginServesFile,
} from './published-origin.ts';

const published = 'https://pages.example.net';
const token = 'a'.repeat(43);

await test('the published origin serves the reader path and nothing else', () => {
  for (const operationId of [
    'getPublishedPage',
    'openPublishedPage',
    'unlockPublishedLink',
    'getPublishedAttachment',
    'getReportPage',
    'reportPublishedLink',
  ])
    assert.deepEqual(
      publishedOriginDecision('published', published, {
        operationId,
        method: 'GET',
        url: `/published/${token}`,
      }),
      { kind: 'serve' },
      operationId,
    );
  for (const operationId of [
    'getAccount',
    'signInWithPassword',
    'createOwner',
    'getHealth',
    'listFiles',
  ])
    assert.deepEqual(
      publishedOriginDecision('published', published, {
        operationId,
        method: 'POST',
        url: '/api/account',
      }),
      { kind: 'refuse' },
      operationId,
    );
});

await test('the published origin serves a stylesheet and a font, and no shell or script', () => {
  const decide = (url: string, method = 'GET') =>
    publishedOriginDecision('published', published, {
      operationId: undefined,
      method,
      url,
    }).kind;
  assert.equal(decide('/assets/app-9mBXVEmD.css'), 'serve');
  assert.equal(decide('/assets/geist-latin.woff2?v=1'), 'serve');
  assert.equal(decide('/assets/main-DZoQRQzA.js'), 'refuse');
  for (const icon of [
    '/favicon.ico',
    '/favicon.svg',
    '/apple-touch-icon.png',
  ]) {
    assert.equal(decide(icon), 'serve');
    assert.equal(decide(icon, 'HEAD'), 'serve');
    assert.equal(decide(icon, 'POST'), 'refuse');
  }
  assert.equal(decide('/other.ico'), 'refuse');
  assert.equal(decide('/'), 'refuse');
  assert.equal(decide('/index.html'), 'refuse');
  assert.equal(decide('/sw.js'), 'refuse');
  assert.equal(decide('/w/abc/settings'), 'refuse');
  assert.equal(decide('/assets/app.css', 'POST'), 'refuse');
  assert.equal(publishedOriginServesFile('/assets/../index.css'), false);
  assert.equal(publishedOriginServesFile('/assets/a/b.css'), false);
});

await test('the published origin serves the diagram script and frame, and no other script', () => {
  // Record 0158. A note that holds a diagram loads one script of the build
  // and the frame document that it puts on the page.
  const decide = (url: string, method = 'GET') =>
    publishedOriginDecision('published', published, {
      operationId: undefined,
      method,
      url,
    }).kind;
  assert.equal(decide('/assets/published-page-M0Ar9lYV.js'), 'serve');
  assert.equal(decide('/src/diagram/frame.html'), 'serve');
  assert.equal(decide('/src/diagram/frame.html', 'POST'), 'refuse');
  // A name that is close to the script is still not the script.
  assert.equal(decide('/assets/published-page-M0Ar9lYV.js.map'), 'refuse');
  assert.equal(decide('/assets/published-diagrams.js'), 'refuse');
  assert.equal(decide('/assets/published-links-BgGi9BLm.js'), 'refuse');
  assert.equal(decide('/src/diagram/frame-main.ts'), 'refuse');
  assert.equal(decide('/src/diagram/other.html'), 'refuse');
  assert.equal(
    publishedOriginServesFile('/assets/../published-page-M0Ar9lYV.js'),
    false,
  );
});

await test('the application origin moves a reader address with a temporary redirect', () => {
  assert.deepEqual(
    publishedOriginDecision('application', published, {
      operationId: 'getPublishedPage',
      method: 'GET',
      url: `/published/${token}?note=x`,
    }),
    {
      kind: 'redirect',
      location: `${published}/published/${token}?note=x`,
    },
  );
  assert.deepEqual(
    publishedOriginDecision('application', published, {
      operationId: 'getAccount',
      method: 'GET',
      url: '/api/account',
    }),
    { kind: 'serve' },
  );
  // With no published origin, the application origin serves the reader path.
  assert.deepEqual(
    publishedOriginDecision('application', null, {
      operationId: 'getPublishedPage',
      method: 'GET',
      url: `/published/${token}`,
    }),
    { kind: 'serve' },
  );
});
