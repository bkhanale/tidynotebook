/** The bounded cache of the bodies of published notes (review R5). */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRenderCache,
  publishedRenderKey,
  type PublishedRenderInput,
} from './published-render-cache.ts';

/** A render that counts how often it runs. */
function counting(body: string): {
  readonly render: () => Promise<string>;
  readonly calls: () => number;
} {
  let calls = 0;
  return {
    render: () => {
      calls += 1;
      return Promise.resolve(body);
    },
    calls: () => calls,
  };
}

await test('a second read of one key renders nothing again', async () => {
  const cache = createRenderCache({ entries: 4, characters: 1000 });
  const one = counting('<p>one</p>');
  assert.equal(await cache.body('a', one.render), '<p>one</p>');
  assert.equal(await cache.body('a', one.render), '<p>one</p>');
  assert.equal(one.calls(), 1);
});

await test('the cache keeps its bounds and drops the oldest body first', async () => {
  const cache = createRenderCache({ entries: 2, characters: 10 });
  const first = counting('aaaa');
  await cache.body('a', first.render);
  await cache.body('b', counting('bbbb').render);
  // Reading `a` makes it the newest, so `b` is the oldest now.
  await cache.body('a', first.render);
  await cache.body('c', counting('cccc').render);
  assert.equal(cache.size(), 2);
  const again = counting('bbbb');
  await cache.body('b', again.render);
  assert.equal(again.calls(), 1, 'the oldest body was dropped');
  assert.equal(first.calls(), 1, 'the newest body stayed');
  // A body larger than the budget is answered and never kept.
  const large = counting('x'.repeat(11));
  await cache.body('large', large.render);
  await cache.body('large', large.render);
  assert.equal(large.calls(), 2);
});

await test('every input that decides the body changes the key', () => {
  const base: PublishedRenderInput = {
    fileId: 'f',
    revisionId: 'r1',
    path: 'notes/a.md',
    token: 't',
    ticket: null,
    notes: [['f', 'notes/a.md']],
    attachments: [],
  };
  const key = publishedRenderKey(base);
  assert.equal(publishedRenderKey({ ...base }), key);
  for (const changed of [
    { ...base, revisionId: 'r2' },
    { ...base, path: 'notes/b.md' },
    { ...base, token: 'u' },
    { ...base, ticket: 'k' },
    { ...base, notes: [...base.notes, ['g', 'notes/g.md'] as const] },
    { ...base, attachments: [['p.png', 'r'] as const] },
  ])
    assert.notEqual(publishedRenderKey(changed), key);
  // The key holds no secret of the address in the clear.
  assert.ok(
    !publishedRenderKey({ ...base, token: 'secret-token' }).includes('secret'),
  );
});
