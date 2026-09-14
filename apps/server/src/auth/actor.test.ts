import assert from 'node:assert/strict';
import test from 'node:test';
import { accountForSession } from './actor.ts';

await test('an unlinked session cannot create a second account', async () => {
  let firstLinkCalls = 0;
  const account = await accountForSession(
    {
      accountOf: () => Promise.resolve(null),
      linkFirstAccount: () => {
        firstLinkCalls += 1;
        return Promise.resolve(null);
      },
    },
    'unlinked-auth-user',
  );

  assert.equal(account, null);
  assert.equal(firstLinkCalls, 1);
});

await test('a linked session reuses its account', async () => {
  let firstLinkCalls = 0;
  const account = await accountForSession(
    {
      accountOf: () => Promise.resolve('existing-account'),
      linkFirstAccount: () => {
        firstLinkCalls += 1;
        return Promise.resolve('new-account');
      },
    },
    'linked-auth-user',
  );

  assert.equal(account, 'existing-account');
  assert.equal(firstLinkCalls, 0);
});
