import assert from 'node:assert/strict';
import test from 'node:test';
import { createFactStore, sameMembers } from './fact-store.ts';
import { noteSaveReport } from './save-state.ts';

await test('a write of an equal value tells no reader', () => {
  const store = createFactStore<{ readonly saved: string | null } | null>(
    null,
    sameMembers,
  );
  let heard = 0;
  store.subscribe(() => {
    heard += 1;
  });
  store.set({ saved: null });
  store.set({ saved: null });
  assert.equal(heard, 1);
  store.set({ saved: '2026-10-02T10:00:00.000Z' });
  assert.equal(heard, 2);
  store.set(null);
  store.set(null);
  assert.equal(heard, 3);
});

await test('a stopped reader hears nothing more', () => {
  const store = createFactStore<number>(0, Object.is);
  let heard = 0;
  const stop = store.subscribe(() => {
    heard += 1;
  });
  store.set(1);
  stop();
  store.set(2);
  assert.equal(heard, 1);
  assert.equal(store.get(), 2);
});

await test('a plain edit changes no fact that the frame reads', () => {
  // Record 0175. The frame read the save state of the open note, which a
  // key moved from saved to saving and back, so every key rendered it.
  const store = createFactStore(
    noteSaveReport({ storageError: null, lastSavedAt: null }),
    sameMembers,
  );
  let heard = 0;
  store.subscribe(() => {
    heard += 1;
  });
  // A key, a draft write and a queue read state the same two facts.
  for (let step = 0; step < 50; step += 1)
    store.set(noteSaveReport({ storageError: null, lastSavedAt: null }));
  assert.equal(heard, 0);
  // A version and a failed write are facts the frame shows.
  store.set(
    noteSaveReport({
      storageError: null,
      lastSavedAt: '2026-10-02T10:00:00.000Z',
    }),
  );
  store.set(
    noteSaveReport({
      storageError: 'quota',
      lastSavedAt: '2026-10-02T10:00:00.000Z',
    }),
  );
  assert.equal(heard, 2);
});
