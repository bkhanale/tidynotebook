import assert from 'node:assert/strict';
import test from 'node:test';
import { maxAttemptKeys, SharedAttemptStore } from './attempt-store.ts';

/** The state that one attempt against `key` produces. */
function count(
  store: SharedAttemptStore,
  key: string,
  timeWindow = 60_000,
): { current: number; ttl: number } {
  let state = { current: 0, ttl: 0 };
  store.incr(
    key,
    (_error, result) => {
      if (result !== undefined) state = { ...result };
    },
    timeWindow,
  );
  return state;
}

await test('two routes of one group count against one bucket', () => {
  // The defect this covers: the plugin builds a child store for each route
  // that carries a limit, and the store it ships gave each child a counter of
  // its own. The key of an attempt already names the group, so the two keys
  // were equal and landed in two maps. A caller had the attempts of both
  // paths at one password.
  const store = new SharedAttemptStore();
  const pageForm = store.child();
  const unlock = store.child();
  const key = '203.0.113.5published';

  assert.equal(count(pageForm, key).current, 1);
  assert.equal(count(unlock, key).current, 2);
  assert.equal(count(pageForm, key).current, 3);
  assert.equal(count(unlock, key).current, 4);
});

await test('two groups and two callers stay apart', () => {
  const store = new SharedAttemptStore();
  const published = store.child();
  const setup = store.child();
  assert.equal(count(published, '203.0.113.5published').current, 1);
  assert.equal(count(setup, '203.0.113.5setup').current, 1);
  assert.equal(count(published, '203.0.113.9published').current, 1);
  assert.equal(count(published, '203.0.113.5published').current, 2);
});

await test('a window that ended starts the count again', () => {
  let now = 1_000_000;
  const store = new SharedAttemptStore({ now: () => now });
  const route = store.child();
  assert.equal(count(route, 'caller').current, 1);
  assert.equal(count(route, 'caller').current, 2);
  now += 60_000;
  assert.equal(count(route, 'caller').current, 1);
});

await test('the time left shrinks inside one window', () => {
  let now = 1_000_000;
  const store = new SharedAttemptStore({ now: () => now });
  const route = store.child();
  assert.equal(count(route, 'caller').ttl, 60_000);
  now += 20_000;
  assert.equal(count(route, 'caller').ttl, 40_000);
});

await test('a read states the count and does not raise it', () => {
  const store = new SharedAttemptStore();
  const route = store.child();
  count(route, 'caller');
  let read = { current: -1, ttl: -1 };
  route.read(
    'caller',
    (_error, result) => {
      if (result !== undefined) read = { ...result };
    },
    60_000,
  );
  assert.equal(read.current, 1);
  assert.equal(count(route, 'caller').current, 2);
});

await test('the map is bounded, so invented keys cannot grow it without end', () => {
  const store = new SharedAttemptStore();
  const route = store.child();
  for (let index = 0; index < maxAttemptKeys + 500; index += 1)
    count(route, `caller-${String(index)}`);
  assert.equal(store.keyCount, maxAttemptKeys);
});
