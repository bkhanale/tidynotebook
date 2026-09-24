import assert from 'node:assert/strict';
import test from 'node:test';
import { readPort } from './dev-app.mjs';

await test('the local port accepts only a valid TCP port', () => {
  assert.equal(readPort([]), 3000);
  assert.equal(readPort(['--port', '3123']), 3123);
  for (const args of [
    ['--port', '0'],
    ['--port', '65536'],
    ['--port', 'abc'],
    ['--port', '3123', 'extra'],
  ]) {
    assert.throws(() => readPort(args));
  }
});
