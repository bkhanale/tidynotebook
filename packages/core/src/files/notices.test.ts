/** Checks of the rules of a sync notice stream. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptySubscription,
  noticeBatch,
  replaceSubscription,
  type NoticeSubscription,
} from './notices.ts';

const a = '00000000-0000-4000-8000-00000000000a';
const b = '00000000-0000-4000-8000-00000000000b';
const c = '00000000-0000-4000-8000-00000000000c';

function set(generation: number, ids: readonly string[]): NoticeSubscription {
  return { generation, workspaceIds: new Set(ids) };
}

await test('a newer set of readable workspaces replaces the set', () => {
  const replaced = replaceSubscription(
    set(1, [a]),
    { generation: 2, workspaceIds: [b, c] },
    [a, b, c],
  );
  assert.equal(replaced.ok, true);
  if (replaced.ok) {
    assert.equal(replaced.subscription.generation, 2);
    assert.deepEqual([...replaced.subscription.workspaceIds], [b, c]);
  }
});

await test('the first set replaces the empty stream, and an empty set is valid', () => {
  const first = replaceSubscription(
    emptySubscription,
    { generation: 1, workspaceIds: [] },
    [],
  );
  assert.equal(first.ok, true);
});

await test('a generation that is not newer is refused before access', () => {
  for (const generation of [1, 0]) {
    const refused = replaceSubscription(
      set(1, [a]),
      { generation, workspaceIds: [c] },
      [],
    );
    assert.deepEqual(refused, { ok: false, reason: 'stale_generation' });
  }
});

await test('a set with one unreadable workspace is refused as a whole', () => {
  const refused = replaceSubscription(
    set(1, [a]),
    { generation: 2, workspaceIds: [a, c] },
    [a, b],
  );
  assert.deepEqual(refused, { ok: false, reason: 'forbidden' });
});

await test('a batch notifies the changed workspaces of the set, in order', () => {
  const batch = noticeBatch(set(3, [c, a, b]), new Set([c, a, 'other']), [
    a,
    b,
    c,
  ]);
  assert.deepEqual(batch.notify, [a, c]);
  assert.deepEqual([...batch.subscription.workspaceIds], [c, a, b]);
});

await test('a workspace that the account lost leaves the set and hears nothing', () => {
  const batch = noticeBatch(set(3, [a, b]), new Set([a, b]), [b]);
  assert.deepEqual(batch.notify, [b]);
  assert.deepEqual([...batch.subscription.workspaceIds], [b]);
  assert.equal(batch.subscription.generation, 3);
});
