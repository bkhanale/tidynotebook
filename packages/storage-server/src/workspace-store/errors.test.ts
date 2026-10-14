import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseFailure, operational } from './errors.ts';

await test('database resource failures are unavailable and keep no private detail', () => {
  for (const code of ['53000', '53100', '53200', '53300', '53400']) {
    const driver = {
      code,
      detail: 'private detail',
      query: 'private statement',
      parameters: ['private parameter'],
    };
    for (const failure of [
      driver,
      new Error('private wrapper', { cause: driver }),
    ]) {
      const error = operational(failure);
      assert.equal(error.kind, 'unavailable', code);
      assert.ok(error.cause instanceof DatabaseFailure);
      assert.equal(error.cause.sqlState, code);
      assert.equal(JSON.stringify(error).includes('private'), false);
      assert.equal(error.message.includes('private'), false);
      assert.equal(error.cause.message.includes('private'), false);
    }
  }
});

await test('a database defect remains unexpected', () => {
  assert.equal(operational({ code: 'XX000' }).kind, 'unexpected');
  assert.equal(operational({ code: '23505' }).kind, 'unexpected');
});
