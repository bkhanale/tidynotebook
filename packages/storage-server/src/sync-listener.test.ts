/** Checks of the payload reader of the sync hint channel. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSyncHint } from './sync-listener.ts';

const id = '0f8e2b1c-3d4a-4b5c-8d6e-7f8091a2b3c4';

await test('each hint kind is read from its payload', () => {
  assert.deepEqual(parseSyncHint(`w:${id}`), {
    kind: 'workspace',
    workspaceId: id,
  });
  assert.deepEqual(parseSyncHint(`a:${id}`), {
    kind: 'account',
    accountId: id,
  });
  assert.deepEqual(parseSyncHint('s:session-id-1'), {
    kind: 'session',
    sessionId: 'session-id-1',
  });
  assert.deepEqual(parseSyncHint('p'), { kind: 'publishing' });
});

await test('a payload of no hint reads as null', () => {
  for (const payload of [
    '',
    'w:',
    'w:not-a-uuid',
    `x:${id}`,
    'a:ABC',
    's:',
    `s:${'x'.repeat(257)}`,
    'publishing',
  ])
    assert.equal(parseSyncHint(payload), null, payload);
});
