import assert from 'node:assert/strict';
import test from 'node:test';
import { rebaseFonts, shellAssets } from './assets.ts';

await test('the shell names its stylesheet and its icon', () => {
  const html = [
    '<link rel="manifest" href="/manifest.webmanifest" />',
    '<link rel="icon" type="image/svg+xml" href="/assets/icon-58a1.svg" />',
    '<link rel="modulepreload" crossorigin href="/assets/app.js">',
    '<link rel="stylesheet" crossorigin href="/assets/main-D-Ax.css">',
    '<link rel="stylesheet" href="https://example.com/other.css">',
    '<link rel="stylesheet" href="/assets/../secret.css">',
  ].join('\n');
  assert.deepEqual(shellAssets(html), {
    stylesheets: ['/assets/main-D-Ax.css'],
    icon: '/assets/icon-58a1.svg',
  });
});

await test('a shell with no stylesheet stops the build', () => {
  assert.throws(
    () => shellAssets('<link rel="icon" href="/assets/icon.svg">'),
    /names no stylesheet\. Run pnpm build first/,
  );
});

await test('the fonts move under the base path of the site', () => {
  assert.equal(
    rebaseFonts(
      "@font-face{src:url(/fonts/geist-latin.woff2)}@font-face{src:url('/fonts/geist-mono.woff2')}a{b:url(/assets/x.svg)}",
    ),
    "@font-face{src:url(../fonts/geist-latin.woff2)}@font-face{src:url('../fonts/geist-mono.woff2')}a{b:url(/assets/x.svg)}",
  );
});
