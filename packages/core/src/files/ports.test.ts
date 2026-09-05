/**
 * Infrastructure failures of a storage port.
 *
 * An `OperationalError` is thrown, while a domain failure is returned as a
 * `Result`. The HTTP adapter uses `isOperationalError` to tell them apart and
 * to answer with a generic server error.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isOperationalError, OperationalError } from './ports.ts';

await test('an operational error keeps its kind and its message', () => {
  const error = new OperationalError('unavailable', 'the database is closed');
  assert.equal(error.kind, 'unavailable');
  assert.equal(error.message, 'the database is closed');
  assert.equal(error.name, 'OperationalError');
  assert.ok(error instanceof Error);
  assert.equal(error.cause, undefined);
});

await test('an operational error can carry the failure that caused it', () => {
  const cause = new Error('connection reset');
  const error = new OperationalError('timeout', 'the lock wait ended', {
    cause,
  });
  assert.equal(error.cause, cause);
  assert.equal(error.kind, 'timeout');
});

await test('the guard accepts only an operational error', () => {
  assert.equal(
    isOperationalError(new OperationalError('serialization', 'retry')),
    true,
  );
  assert.equal(isOperationalError(new Error('plain')), false);
  assert.equal(isOperationalError({ kind: 'unexpected' }), false);
  assert.equal(isOperationalError('unavailable'), false);
  assert.equal(isOperationalError(null), false);
  assert.equal(isOperationalError(undefined), false);
});

await test('a caught value is narrowed by the guard', () => {
  let caught: unknown;
  try {
    throw new OperationalError('unexpected', 'no rows were written');
  } catch (error) {
    caught = error;
  }
  assert.equal(isOperationalError(caught), true);
  if (isOperationalError(caught)) assert.equal(caught.kind, 'unexpected');
});
