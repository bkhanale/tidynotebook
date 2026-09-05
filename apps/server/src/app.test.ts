import assert from 'node:assert/strict';
import test from 'node:test';
import { hostName, requestId } from './app.ts';

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
