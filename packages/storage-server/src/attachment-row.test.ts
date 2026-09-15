/**
 * Checks the parsers that read the union columns of an attachment row.
 *
 * The accepted path must give back the same value, so a good row costs
 * nothing. The refused path must throw, because a silent answer would let a
 * value the domain never declared reach an attachment record.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isOperationalError } from '@notesapp/core';
import { storedAttachmentState, storedMediaType } from './attachment-row.ts';

await test('an accepted media type reads back unchanged', () => {
  for (const value of ['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
    assert.equal(storedMediaType(value), value);
});

await test('a media type the domain refuses stops the read', () => {
  // SVG is deliberately not an attachment type, and an empty column is a
  // partial write. Both must fail loudly rather than reach the record.
  for (const value of ['image/svg+xml', 'text/plain', 'IMAGE/PNG', '']) {
    assert.throws(
      () => storedMediaType(value),
      (error: unknown) => {
        assert.ok(isOperationalError(error));
        assert.equal(error.kind, 'unexpected');
        assert.match(error.message, /media type/);
        return true;
      },
      value,
    );
  }
});

await test('an accepted attachment state reads back unchanged', () => {
  for (const value of ['temporary', 'finalized', 'unavailable'])
    assert.equal(storedAttachmentState(value), value);
});

await test('a state the domain does not declare stops the read', () => {
  for (const value of ['deleted', 'pending', '']) {
    assert.throws(
      () => storedAttachmentState(value),
      (error: unknown) => {
        assert.ok(isOperationalError(error));
        assert.equal(error.kind, 'unexpected');
        assert.match(error.message, /state/);
        return true;
      },
      value,
    );
  }
});
