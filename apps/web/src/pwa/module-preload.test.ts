import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addEntryPreloads,
  preloadOnlyUncontrolled,
  type PreloadPage,
} from './module-preload.ts';

const shell = `<!doctype html>
<html>
  <head>
    <script type="module" crossorigin src="/assets/main-1.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/runtime-2.js">
    <link rel="modulepreload" crossorigin href="/assets/app-3.js">
    <link rel="stylesheet" crossorigin href="/assets/main-4.css">
  </head>
  <body><div id="root"></div></body>
</html>
`;

/** A page with or without a controlling worker, and the links it took. */
function page(controller: unknown): {
  readonly page: PreloadPage;
  readonly added: string[];
} {
  const added: string[] = [];
  return {
    added,
    page: {
      navigator: { serviceWorker: { controller } },
      document: {
        createElement: () => ({ rel: '', crossOrigin: null, href: '' }),
        head: {
          appendChild: (link) => {
            added.push(`${link.rel} ${String(link.crossOrigin)} ${link.href}`);
          },
        },
      },
    },
  };
}

await test('the shell writes no preload link of its own', () => {
  // Record 0180. On a load that the worker controlled, a preload and the
  // module script of one module both reached the worker, and the browser
  // aborted one of them: the entry failed and the page stayed white.
  const html = preloadOnlyUncontrolled(shell);
  assert.doesNotMatch(html, /<link rel="modulepreload"/);
  assert.match(
    html,
    /<script type="module" crossorigin src="\/assets\/main-1.js">/,
  );
  assert.match(html, /rel="stylesheet"/);
  // The inline script runs the one rule below on the addresses of the links.
  assert.ok(
    html.includes(
      `(${addEntryPreloads.toString()})(["/assets/runtime-2.js","/assets/app-3.js"], window);`,
    ),
    html,
  );
});

await test('a load that no worker controls still preloads the entry', () => {
  const subject = page(null);
  addEntryPreloads(['/assets/runtime-2.js', '/assets/app-3.js'], subject.page);
  assert.deepEqual(subject.added, [
    'modulepreload  /assets/runtime-2.js',
    'modulepreload  /assets/app-3.js',
  ]);
});

await test('a load that the worker controls preloads nothing', () => {
  const subject = page({ scriptURL: '/service-worker.js' });
  addEntryPreloads(['/assets/runtime-2.js'], subject.page);
  assert.deepEqual(subject.added, []);
});

await test('a shell with no preload link stays as it is', () => {
  const plain = '<html><head></head><body></body></html>';
  assert.equal(preloadOnlyUncontrolled(plain), plain);
});
