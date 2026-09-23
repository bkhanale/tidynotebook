/**
 * The one list of asset kinds, and the two rules that read it.
 *
 * The build stores a file in the precache and the worker keeps a request for
 * it. Each kind of the list, and each kind outside it, gets the same answer
 * from both rules, so the two cannot drift apart again.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assetKinds, isAssetPath, kindOf } from './asset-kinds.ts';
import { derivePrecache } from './precache.ts';
import { isCacheableAsset } from './routing.ts';

const origin = 'https://notes.example';

/** Whether the build stores one address in the precache. */
function precaches(path: string): boolean {
  return derivePrecache([{ url: path, size: 10, digest: 'aa' }]).urls.includes(
    path,
  );
}

/** Whether the worker keeps a request for one address. */
function keeps(path: string): boolean {
  return isCacheableAsset(
    { method: 'GET', mode: 'no-cors', url: `${origin}${path}` },
    origin,
  );
}

await test('the build and the worker agree on every kind of the list', () => {
  for (const kind of assetKinds) {
    const path = `/assets/file-AbCd.${kind}`;
    assert.equal(precaches(path), true, `the build stores ${kind}`);
    assert.equal(keeps(path), true, `the worker keeps ${kind}`);
  }
});

await test('the build and the worker agree on a kind outside the list', () => {
  for (const kind of ['map', 'br', 'gz', 'json', 'txt', '']) {
    const path = kind === '' ? '/assets/file' : `/assets/file.${kind}`;
    assert.equal(precaches(path), false, `the build skips ${kind}`);
    assert.equal(keeps(path), false, `the worker skips ${kind}`);
  }
});

await test('a font kind that the worker served is stored by the build too', () => {
  // The two lists once differed by this kind.
  assert.equal(precaches('/fonts/face.otf'), true);
  assert.equal(keeps('/fonts/face.otf'), true);
});

await test('the kind of a path is the text after its last dot', () => {
  assert.equal(kindOf('/assets/main-AbCd.js.map'), 'map');
  assert.equal(kindOf('/fonts/Face.WOFF2'), 'woff2');
  assert.equal(kindOf('/v1.2/readme'), '');
  assert.equal(isAssetPath('/index.html'), true);
});
