/** Checks the target of a streamed download (record 0170). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pickSaveTarget } from './save-stream.ts';

await test('a browser with a save picker writes the download into the picked file', async () => {
  // Review of issue 243. The export loaded the whole archive into a blob, so
  // a large export needed memory of its size.
  const writable = new WritableStream<Uint8Array>();
  let suggested = '';
  const scope = {
    showSaveFilePicker: (options: { suggestedName: string }) => {
      suggested = options.suggestedName;
      return Promise.resolve({
        createWritable: () => Promise.resolve(writable),
      });
    },
  };
  const target = await pickSaveTarget(scope, 'notes.zip');
  assert.equal(suggested, 'notes.zip');
  assert.deepEqual(target, { kind: 'stream', writable });
});

await test('a closed picker downloads nothing', async () => {
  const scope = {
    showSaveFilePicker: () =>
      Promise.reject(
        Object.assign(new Error('closed'), { name: 'AbortError' }),
      ),
  };
  assert.deepEqual(await pickSaveTarget(scope, 'notes.zip'), {
    kind: 'cancelled',
  });
});

await test('a browser with no picker, or a picker that fails, saves a blob', async () => {
  assert.deepEqual(await pickSaveTarget({}, 'notes.zip'), { kind: 'blob' });
  const failing = {
    showSaveFilePicker: () =>
      Promise.reject(
        Object.assign(new Error('denied'), { name: 'SecurityError' }),
      ),
  };
  assert.deepEqual(await pickSaveTarget(failing, 'notes.zip'), {
    kind: 'blob',
  });
  const odd = { showSaveFilePicker: () => Promise.resolve({}) };
  assert.deepEqual(await pickSaveTarget(odd, 'notes.zip'), { kind: 'blob' });
});
