import assert from 'node:assert/strict';
import test from 'node:test';
import { createModuleLoad } from './module-load.ts';

await test('a module that did not arrive answers a failure and loads again later', async () => {
  // Record 0177. The keyboard shortcuts loaded as a lazy component, and a
  // chunk that did not arrive replaced the whole screen with the error page.
  let calls = 0;
  let fail = true;
  const load = createModuleLoad(() => {
    calls += 1;
    return fail
      ? Promise.reject(new Error('Importing a module script failed.'))
      : Promise.resolve('dialog');
  });
  assert.deepEqual(await load(), { ok: false });
  fail = false;
  assert.deepEqual(await load(), { ok: true, value: 'dialog' });
  assert.equal(calls, 2);
});

await test('a module that arrived loads once', async () => {
  let calls = 0;
  const load = createModuleLoad(() => {
    calls += 1;
    return Promise.resolve('dialog');
  });
  await Promise.all([load(), load()]);
  await load();
  assert.equal(calls, 1);
});
