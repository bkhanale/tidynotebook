/**
 * Checks which earlier staging plan a new staging takes over (record 0176).
 *
 * A plan of another engine can still fill, for example in a handover of the
 * lease during a pass. A new staging that removed it made that engine fail
 * its activation as a corrupt store.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { StagedSnapshot } from '@notesapp/sync';
import { stagingOwnedBy } from './snapshot.ts';

const now = Date.parse('2026-10-03T12:00:00.000Z');

function plan(owner: string | null, createdAt: string): StagedSnapshot {
  return {
    serverOrigin: 'https://notes.example.test',
    accountId: 'account-1',
    workspaceId: 'workspace-1',
    token: 'token-1',
    revisionIds: [],
    cursor: '1',
    state: 'staging',
    createdAt,
    owner,
  };
}

await test('a staging takes over its own plan and a plan of an earlier release', () => {
  assert.equal(
    stagingOwnedBy(
      plan('engine-a', '2026-10-03T11:59:00.000Z'),
      'engine-a',
      now,
    ),
    true,
  );
  assert.equal(
    stagingOwnedBy(plan(null, '2026-10-03T11:59:00.000Z'), 'engine-a', now),
    true,
  );
});

await test('a staging keeps a plan that another engine can still fill', () => {
  assert.equal(
    stagingOwnedBy(
      plan('engine-b', '2026-10-03T11:59:00.000Z'),
      'engine-a',
      now,
    ),
    false,
  );
});

await test('a plan of a tab that closed during its pass goes after a long time', () => {
  assert.equal(
    stagingOwnedBy(
      plan('engine-b', '2026-10-03T10:59:00.000Z'),
      'engine-a',
      now,
    ),
    true,
  );
  assert.equal(
    stagingOwnedBy(plan('engine-b', 'not a time'), 'engine-a', now),
    true,
  );
});
