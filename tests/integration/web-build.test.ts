/**
 * The installed worker that the browser build writes.
 *
 * `pnpm test:integration` builds the workspace first, so these checks read the
 * real output of `apps/web` rather than a fixture. They prove the three
 * properties that only fail in a browser: the worker is a classic script, it
 * carries the addresses of this build, and its cache follows the bytes of this
 * build.
 *
 * The derivation runs a second time here, over the files on disk, and the name
 * it produces must be the name inside the worker. A worker that is stamped
 * from another list, or that keeps a fixed name, therefore fails here.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  derivePrecache,
  directoryFiles,
} from '../../apps/web/src/pwa/precache.ts';

const distribution = join(import.meta.dirname, '../../apps/web/dist/web');

/** The built worker, or a failure that names the one cause. */
async function readWorker(): Promise<string> {
  try {
    return await readFile(join(distribution, 'service-worker.js'), 'utf8');
  } catch {
    throw new Error(
      'The browser build is absent. Run pnpm build before this test.',
    );
  }
}

await test('the built worker is a classic script', async () => {
  const worker = await readWorker();
  // The page registers the worker with no module type, so a top level
  // `import` or `export` would fail before the worker ran once.
  assert.doesNotMatch(worker, /(?:^|\n)\s*(?:import|export)[\s{'"(]/);
});

await test('the built worker holds the addresses of this build', async () => {
  const worker = await readWorker();
  const precache = derivePrecache(await directoryFiles(distribution));
  assert.ok(precache.urls.includes('/index.html'));
  assert.ok(precache.urls.includes('/manifest.webmanifest'));
  assert.ok(!precache.urls.includes('/service-worker.js'));
  assert.ok(!precache.urls.some((url) => url.startsWith('/src/diagram/')));
  for (const url of precache.urls) assert.ok(worker.includes(url), url);
});

await test('the cache of the built worker follows its bytes', async () => {
  const worker = await readWorker();
  const precache = derivePrecache(await directoryFiles(distribution));
  assert.ok(worker.includes(precache.cacheName), precache.cacheName);
  // A fixed name served the shell of an older deployment until the browser
  // evicted it, because the address of the shell never changes.
  assert.ok(!worker.includes('notesapp-app-v1'));
});
