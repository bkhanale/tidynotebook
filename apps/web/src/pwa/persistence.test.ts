import assert from 'node:assert/strict';
import test from 'node:test';
import {
  persistenceAtRiskMessage,
  persistenceNotice,
  persistenceQuietMessage,
  readPersistenceOutcome,
  type PersistenceRequest,
} from './persistence.ts';

/** A device whose browser refused, with no work that waits. */
const refused = {
  outcome: 'denied',
  closed: false,
  unsentWork: false,
  sending: true,
} as const;

await test('a refusal with no work at risk is one quiet notice', () => {
  // The defect this covers: every refusal showed a large problem notice above
  // every page, though the server kept every note and nothing was at risk.
  assert.deepEqual(persistenceNotice(refused), {
    kind: 'quiet',
    message: persistenceQuietMessage,
  });
  // Work that can go to the server now is not at risk either.
  assert.equal(
    persistenceNotice({ ...refused, unsentWork: true, sending: true }).kind,
    'quiet',
  );
});

await test('a closed quiet notice does not come back on the device', () => {
  assert.deepEqual(persistenceNotice({ ...refused, closed: true }), {
    kind: 'none',
  });
});

await test('work that is on this device alone is at risk and says so', () => {
  const offline = { ...refused, unsentWork: true, sending: false };
  assert.deepEqual(persistenceNotice(offline), {
    kind: 'at-risk',
    message: persistenceAtRiskMessage,
  });
  // Closing the fact is not accepting a loss.
  assert.equal(persistenceNotice({ ...offline, closed: true }).kind, 'at-risk');
});

await test('only a refusal speaks', () => {
  for (const outcome of ['granted', 'unsupported', null] as const)
    for (const unsentWork of [false, true])
      assert.deepEqual(
        persistenceNotice({
          outcome,
          closed: false,
          unsentWork,
          sending: false,
        }),
        { kind: 'none' },
      );
});

await test('a stored outcome is read and anything else is not asked yet', () => {
  for (const outcome of ['granted', 'denied', 'unsupported'] as const)
    assert.equal(readPersistenceOutcome(outcome), outcome);
  for (const value of [null, '', 'no', 'DENIED'])
    assert.equal(readPersistenceOutcome(value), null);
  const typed: PersistenceRequest | null = readPersistenceOutcome('denied');
  assert.equal(typed, 'denied');
});

await test('each sentence states the fact and the next step plainly', () => {
  for (const message of [persistenceQuietMessage, persistenceAtRiskMessage]) {
    assert.doesNotMatch(message, /persistent storage|durable|evict/i);
    assert.doesNotMatch(message, /[–—]/);
    assert.ok(message.endsWith('.'));
  }
  assert.match(persistenceAtRiskMessage, /Keep this tab open/);
});
