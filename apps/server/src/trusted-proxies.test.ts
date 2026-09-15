import assert from 'node:assert/strict';
import test from 'node:test';
import { readTrustedProxies } from './trusted-proxies.ts';

/** The parsed list, or a clear test failure. */
function proxiesOf(value: string | undefined): readonly string[] {
  const result = readTrustedProxies(value);
  if (!result.ok)
    throw new Error(`The list was refused: ${result.issues.join(' ')}`);
  return result.proxies;
}

/** The refusal messages, or a clear test failure. */
function issuesOf(value: string): readonly string[] {
  const result = readTrustedProxies(value);
  if (result.ok) throw new Error('The list was accepted.');
  return result.issues;
}

await test('a deployment that names no proxy trusts none', () => {
  assert.deepEqual(proxiesOf(undefined), []);
  assert.deepEqual(proxiesOf(''), []);
  assert.deepEqual(proxiesOf('  ,  '), []);
});

await test('an address, a range, and a name are each one entry', () => {
  assert.deepEqual(
    proxiesOf('10.5.0.2, 172.16.0.0/12 ,uniquelocal, ::1, fc00::/7'),
    ['10.5.0.2', '172.16.0.0/12', 'uniquelocal', '::1', 'fc00::/7'],
  );
  assert.deepEqual(proxiesOf('loopback,linklocal'), ['loopback', 'linklocal']);
});

await test('a value that names no address and no range stops startup', () => {
  for (const value of [
    'proxy.example.com',
    '10.5.0.2:8080',
    'https://proxy.example.com',
    'private',
    '10.5.0.0/',
    '10.5.0.0/33',
    'fc00::/129',
    '10.5.0.0/0x10',
  ]) {
    const issues = issuesOf(value);
    assert.equal(issues.length, 1);
    assert.match(String(issues[0]), /^NOTESAPP_TRUSTED_PROXIES: /);
  }
});

await test('a repeated proxy stops startup', () => {
  const issues = issuesOf('10.5.0.2, 10.5.0.2');
  assert.equal(issues.length, 1);
  assert.match(String(issues[0]), /one time only/);
});

await test('a refusal never repeats the rejected value', () => {
  for (const issue of issuesOf('proxy.example.com'))
    assert.ok(!issue.includes('proxy.example.com'));
});
