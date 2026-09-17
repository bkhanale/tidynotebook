import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forEachBounded,
  isCacheableAsset,
  servedByWorker,
  type RoutedRequest,
} from './routing.ts';

const origin = 'https://notes.invalid';

/** One request, as a routing decision reads it. */
function asked(url: string, mode = 'cors', method = 'GET'): RoutedRequest {
  return { url, mode, method };
}

await test('a same-origin static asset is one the worker may keep', () => {
  assert.ok(isCacheableAsset(asked(`${origin}/assets/shell-AbCd.js`), origin));
  assert.ok(isCacheableAsset(asked(`${origin}/assets/main-AbCd.css`), origin));
  assert.ok(
    isCacheableAsset(asked(`${origin}/assets/body-AbCd.woff2`), origin),
  );
  assert.ok(isCacheableAsset(asked(`${origin}/manifest.webmanifest`), origin));
  assert.ok(isCacheableAsset(asked(`${origin}/index.html`), origin));
});

await test('an answer that is not a static asset is never kept', () => {
  // An API answer is private and carries no asset extension.
  assert.equal(isCacheableAsset(asked(`${origin}/api/files`), origin), false);
  // Another origin is never stored, whatever its name says.
  assert.equal(
    isCacheableAsset(
      asked('https://other.invalid/assets/shell-AbCd.js'),
      origin,
    ),
    false,
  );
  // A write is never an asset read.
  assert.equal(
    isCacheableAsset(
      asked(`${origin}/assets/shell-AbCd.js`, 'cors', 'POST'),
      origin,
    ),
    false,
  );
});

await test('the worker serves a navigation, because it holds the shell', () => {
  // The navigate branch of the worker answers a failed network with the
  // stored shell. That fallback is the whole offline launch, so a navigation
  // stays with the worker.
  const pinned = new Set<string>();
  assert.ok(
    servedByWorker(
      asked(`${origin}/w/one/notes/two`, 'navigate'),
      origin,
      pinned,
    ),
  );
});

await test('the worker stands aside for a request it cannot answer', () => {
  const pinned = new Set<string>();
  // A private API read has no stored answer and no fallback.
  assert.equal(
    servedByWorker(asked(`${origin}/api/files`), origin, pinned),
    false,
  );
  // A write never reaches the worker.
  assert.equal(
    servedByWorker(
      asked(`${origin}/api/files`, 'cors', 'POST'),
      origin,
      pinned,
    ),
    false,
  );
  // Another origin is somebody else's.
  assert.equal(
    servedByWorker(
      asked('https://other.invalid/assets/a-AbCd.js'),
      origin,
      pinned,
    ),
    false,
  );
});

await test('a static asset and pinned bytes stay with the worker', () => {
  const pinned = new Set([`${origin}/api/attachments/one`]);
  assert.ok(
    servedByWorker(asked(`${origin}/assets/shell-AbCd.js`), origin, pinned),
  );
  assert.ok(
    servedByWorker(asked(`${origin}/api/attachments/one`), origin, pinned),
  );
  assert.equal(
    servedByWorker(asked(`${origin}/api/attachments/two`), origin, pinned),
    false,
  );
});

await test('a bounded run visits every item exactly once', async () => {
  const items = Array.from({ length: 25 }, (_, index) => index);
  const seen: number[] = [];
  await forEachBounded(items, 3, async (item) => {
    await Promise.resolve();
    seen.push(item);
  });
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    items,
  );
});

await test('a bounded run never exceeds its limit', async () => {
  const items = Array.from({ length: 40 }, (_, index) => index);
  let running = 0;
  let highest = 0;
  await forEachBounded(items, 3, async (item) => {
    running += 1;
    highest = Math.max(highest, running);
    // Two turns, so a reader that started too early would overlap here.
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(item >= 0);
    running -= 1;
  });
  assert.equal(highest, 3);
});

await test('a bounded run takes no reader it cannot use', async () => {
  const visited: string[] = [];
  await forEachBounded(['one'], 3, async (item) => {
    await Promise.resolve();
    visited.push(item);
  });
  assert.deepEqual(visited, ['one']);
  // An empty list starts nothing and still settles.
  await forEachBounded([], 3, async () => {
    throw new Error('An empty list must run no task.');
  });
});

await test('the worker answers no published address', () => {
  // The defect this covers: the navigate branch tried the network and fell
  // back to the stored shell, so a device that holds the application and has
  // no connection answered a published address with the application and its
  // not found screen, rather than with the reader page.
  assert.equal(
    servedByWorker(
      asked(`${origin}/published/abc`, 'navigate'),
      origin,
      new Set(),
    ),
    false,
  );
  assert.equal(
    servedByWorker(
      asked(`${origin}/published/abc?note=1`, 'navigate'),
      origin,
      new Set(),
    ),
    false,
  );
});

await test('the worker still answers every address of the application', () => {
  assert.equal(
    servedByWorker(asked(`${origin}/w/abc`, 'navigate'), origin, new Set()),
    true,
  );
  // A path that only starts with the same letters is the application.
  assert.equal(
    servedByWorker(
      asked(`${origin}/publishedxyz`, 'navigate'),
      origin,
      new Set(),
    ),
    true,
  );
  assert.equal(
    servedByWorker(
      asked(`${origin}/w/abc/published`, 'navigate'),
      origin,
      new Set(),
    ),
    true,
  );
});
