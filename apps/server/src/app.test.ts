import assert from 'node:assert/strict';
import test from 'node:test';
import { closeOpened, hostName, requestId } from './app.ts';

await test('a host name drops its port and its case', () => {
  assert.equal(hostName('Notes.Example:8443'), 'notes.example');
  assert.equal(hostName('notes.example'), 'notes.example');
});

await test('a bracketed IPv6 host keeps its address', () => {
  assert.equal(hostName('[::1]:8080'), '[::1]');
  assert.equal(hostName('[::1]'), '[::1]');
  assert.equal(hostName('[2001:db8::1]:443'), '[2001:db8::1]');
  // A truncated literal must not become a different host.
  assert.equal(hostName('[::1'), '[::1');
});

await test('an absent or empty host name is empty', () => {
  // Configuration rejects an empty allowlist entry, so an empty host name can
  // never be served.
  assert.equal(hostName(undefined), '');
  assert.equal(hostName(''), '');
  assert.equal(hostName('   '), '');
});

await test('a usable correlation id is echoed', () => {
  assert.equal(requestId('trace-abc.123'), 'trace-abc.123');
  assert.equal(
    requestId('123e4567-e89b-12d3-a456-426614174000'),
    '123e4567-e89b-12d3-a456-426614174000',
  );
});

await test('an unusable correlation id becomes a new UUID', () => {
  for (const supplied of [undefined, '', 'not a valid id', 'x'.repeat(129), 42])
    assert.match(requestId(supplied), /^[0-9a-f-]{36}$/);
});

await test('a failed composition closes what it opened, in reverse', async () => {
  // The defect this covers: the composition opened the identity pool, the
  // content pool, the attachment store and the authentication pool, and a
  // failure after any of them threw with every one of them still held. A
  // process that never listened kept its connections to the database.
  const closed: string[] = [];
  await closeOpened([
    () => {
      closed.push('identity');
      return Promise.resolve();
    },
    () => {
      closed.push('content');
      return Promise.resolve();
    },
    () => {
      closed.push('attachments');
      return Promise.resolve();
    },
  ]);
  assert.deepEqual(closed, ['attachments', 'content', 'identity']);
});

await test('a store that cannot close does not stop the others', async () => {
  const closed: string[] = [];
  await closeOpened([
    () => {
      closed.push('identity');
      return Promise.resolve();
    },
    () => Promise.reject(new Error('the pool is already ended')),
    () => {
      closed.push('attachments');
      return Promise.resolve();
    },
  ]);
  assert.deepEqual(closed, ['attachments', 'identity']);
});
