/**
 * The one refusal of the reader path.
 *
 * The rule of decision 0030 is that four causes give one answer. A test that
 * compares two bodies would pass while two values still differ, so these tests
 * compare the identity of the value that the domain returns.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishedLinkUnavailable,
  readerRefusalCauses,
  refuseRead,
  type ReaderRefusalCause,
  type ReaderRefusalLog,
} from './errors.ts';

/** A log that keeps what it received. */
function collector(): ReaderRefusalLog & {
  readonly causes: ReaderRefusalCause[];
} {
  const causes: ReaderRefusalCause[] = [];
  return {
    causes,
    record(cause) {
      causes.push(cause);
    },
  };
}

await test('every cause refuses with one value', () => {
  const log = collector();
  const refusals = readerRefusalCauses.map((cause) =>
    refuseRead<string>(log, cause),
  );
  for (const refusal of refusals) {
    assert.equal(refusal.ok, false);
    if (refusal.ok) return;
    assert.equal(refusal.error, publishedLinkUnavailable);
    assert.equal(refusal.error.code, 'published_link_unavailable');
    assert.deepEqual(refusal.error.fileIds, []);
  }
  assert.deepEqual(log.causes, [...readerRefusalCauses]);
});

await test('the refusal cannot be changed by a caller', () => {
  const before = { ...publishedLinkUnavailable };
  assert.equal(Object.isFrozen(publishedLinkUnavailable), true);
  assert.throws(() => {
    // A caller that tries to name a cause in the refusal fails here.
    Object.defineProperty(publishedLinkUnavailable, 'code', {
      value: 'not_found',
    });
  });
  assert.deepEqual({ ...publishedLinkUnavailable }, before);
});

await test('the refusal names no file', () => {
  assert.deepEqual(publishedLinkUnavailable.fileIds, []);
  assert.equal(Object.isFrozen(publishedLinkUnavailable.fileIds), true);
});
