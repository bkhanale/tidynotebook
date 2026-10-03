import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReloadGuard,
  createScreenWriter,
  type GuardTarget,
} from './screen-writer.ts';

/** A window that counts the reload listeners on it. */
function fakeWindow(): GuardTarget & { readonly listeners: Set<unknown> } {
  const listeners = new Set<unknown>();
  return {
    listeners,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
}

await test('a reload guard blocks and allows a reload while its screen is open', () => {
  const target = fakeWindow();
  const guard = createReloadGuard(target);
  guard.open();
  guard.set(true);
  assert.equal(target.listeners.size, 1);
  guard.set(true);
  assert.equal(target.listeners.size, 1);
  guard.set(false);
  assert.equal(target.listeners.size, 0);
});

await test('a late answer after the screen closed sets no reload guard', () => {
  // Record 0175. A draft write that ended after the note closed set the
  // guard again, and every later reload of the tab asked for a confirmation.
  const target = fakeWindow();
  const guard = createReloadGuard(target);
  guard.open();
  guard.set(true);
  guard.close();
  assert.equal(target.listeners.size, 0);
  guard.set(true);
  assert.equal(target.listeners.size, 0);
  // React mounts a screen again in development, and the guard works again.
  guard.open();
  guard.set(true);
  assert.equal(target.listeners.size, 1);
});

await test('a late answer after the screen closed states no save facts', () => {
  // Record 0175. The facts of a closed note reached the frame of the next
  // screen.
  const written: (string | null)[] = [];
  const writer = createScreenWriter<string | null>((value) => {
    written.push(value);
  }, null);
  writer.write('before open');
  writer.open();
  writer.write('saved');
  writer.close();
  writer.write('late');
  assert.deepEqual(written, ['saved', null]);
});
