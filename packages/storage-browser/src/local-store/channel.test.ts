/**
 * Checks the parser of the cross-tab invalidation channel.
 *
 * A message reaches this parser from another page of the same origin, so it
 * can be anything. An accepted message must read back with every member, and
 * every other message must be dropped: a listener that received one would
 * tell a screen to read a file that no tab of this application changed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { localChangeOf } from './channel.ts';

await test('a complete message reads back with every member', () => {
  assert.deepEqual(
    localChangeOf({
      accountId: 'account-1',
      workspaceId: 'workspace-1',
      fileId: 'file-1',
      kind: 'draft',
    }),
    {
      accountId: 'account-1',
      workspaceId: 'workspace-1',
      fileId: 'file-1',
      kind: 'draft',
    },
  );
});

await test('a message about the whole workspace names no file', () => {
  assert.deepEqual(
    localChangeOf({
      accountId: 'account-1',
      workspaceId: 'workspace-1',
      fileId: null,
      kind: 'reset',
    }),
    {
      accountId: 'account-1',
      workspaceId: 'workspace-1',
      fileId: null,
      kind: 'reset',
    },
  );
});

await test('every kind of the port is accepted', () => {
  for (const kind of [
    'draft',
    'queue',
    'file',
    'purge',
    'conflict',
    'review',
    'cursor',
    'reset',
  ]) {
    const change = localChangeOf({
      accountId: 'account-1',
      workspaceId: 'workspace-1',
      fileId: null,
      kind,
    });
    assert.equal(change?.kind, kind);
  }
});

await test('a message that is not a record is dropped', () => {
  for (const value of [null, undefined, 'draft', 7, [], true])
    assert.equal(localChangeOf(value), null);
});

await test('a message with a member of the wrong kind is dropped', () => {
  const complete = {
    accountId: 'account-1',
    workspaceId: 'workspace-1',
    fileId: null,
    kind: 'draft',
  };
  for (const broken of [
    { ...complete, accountId: 7 },
    { ...complete, accountId: '' },
    { ...complete, workspaceId: null },
    { ...complete, workspaceId: '' },
    { ...complete, fileId: 7 },
    { ...complete, kind: 'rename' },
    { ...complete, kind: 5 },
  ])
    assert.equal(localChangeOf(broken), null, JSON.stringify(broken));
});

await test('a member a message is missing drops it', () => {
  for (const key of ['accountId', 'workspaceId', 'fileId', 'kind']) {
    const partial: Record<string, unknown> = {
      accountId: 'account-1',
      workspaceId: 'workspace-1',
      fileId: null,
      kind: 'draft',
    };
    delete partial[key];
    assert.equal(localChangeOf(partial), null, key);
  }
});

await test('an inherited member cannot pass the check', () => {
  // A page of this origin can post a value whose members sit on a prototype.
  // Only own members count, so such a value is dropped.
  const inherited: unknown = Object.create({
    accountId: 'account-1',
    workspaceId: 'workspace-1',
    fileId: null,
    kind: 'draft',
  });
  assert.equal(localChangeOf(inherited), null);
});
