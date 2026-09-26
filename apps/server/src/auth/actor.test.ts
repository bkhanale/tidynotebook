import assert from 'node:assert/strict';
import test from 'node:test';
import { accountForSession } from './actor.ts';

await test('a session resolves to the account that the store serves', async () => {
  const asked: string[] = [];
  const account = await accountForSession(
    {
      sessionAccount: (authUserId) => {
        asked.push(authUserId);
        return Promise.resolve('existing-account');
      },
    },
    'linked-auth-user',
  );
  assert.equal(account, 'existing-account');
  assert.deepEqual(asked, ['linked-auth-user']);
});

await test('an unlinked, disabled or removed identity resolves to nothing', async () => {
  // The store answers null for each of the three, and the resolver makes no
  // account of its own (records 0108 and 0111).
  const account = await accountForSession(
    { sessionAccount: () => Promise.resolve(null) },
    'unlinked-auth-user',
  );
  assert.equal(account, null);
});
