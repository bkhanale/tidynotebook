/** Checks of the tab interest table and the subscription set. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInterestTable,
  interestTtlMs,
  subscriptionSet,
} from './interests.ts';

await test('each live tab adds its workspace once', () => {
  const table = createInterestTable();
  assert.equal(table.note({ tabId: 'a', workspaceId: 'w2' }, 0), true);
  assert.equal(table.note({ tabId: 'b', workspaceId: 'w1' }, 0), true);
  assert.equal(table.note({ tabId: 'c', workspaceId: 'w2' }, 0), false);
  assert.deepEqual(table.live(0), ['w1', 'w2']);
});

await test('a heartbeat keeps an interest and silence ends it', () => {
  const table = createInterestTable();
  table.note({ tabId: 'a', workspaceId: 'w1' }, 0);
  assert.equal(table.note({ tabId: 'a', workspaceId: 'w1' }, 20_000), false);
  assert.deepEqual(table.live(20_000 + interestTtlMs - 1), ['w1']);
  assert.equal(table.expire(20_000 + interestTtlMs), true);
  assert.deepEqual(table.live(20_000 + interestTtlMs), []);
});

await test('a tab that leaves or opens nothing leaves the set', () => {
  const table = createInterestTable();
  table.note({ tabId: 'a', workspaceId: 'w1' }, 0);
  table.note({ tabId: 'b', workspaceId: 'w2' }, 0);
  assert.equal(table.forget('a', 1), true);
  assert.equal(table.note({ tabId: 'b', workspaceId: null }, 2), true);
  assert.deepEqual(table.live(3), []);
});

await test('the set puts open workspaces first and holds each once', () => {
  assert.deepEqual(subscriptionSet('w1', ['w2', 'w1'], ['w3', 'w2'], 10), [
    'w1',
    'w2',
    'w3',
  ]);
  assert.deepEqual(subscriptionSet(null, ['w2'], ['w3', 'w4'], 2), [
    'w2',
    'w3',
  ]);
});
