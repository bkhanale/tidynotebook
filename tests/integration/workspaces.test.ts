/**
 * The workspace rules under the runtime role.
 *
 * Record 0051 states that an account always keeps one workspace, and it puts
 * the rule in two places: the use case in `packages/core` answers the person
 * with a typed refusal, and `notesapp_delete_workspace` refuses the same call
 * so a caller that reaches the store without the use case is refused as well.
 * This file drives both, against the real database.
 *
 * Start the service first:
 *
 * ```sh
 * sudo -n docker compose -f compose.test.yaml up -d --wait
 * ```
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deleteWorkspace, listWorkspaces } from '@notesapp/core';
import {
  openIdentityStore,
  type IdentityStoreHandle,
} from '@notesapp/storage-server';
import {
  createDisposableDatabase,
  memberActor,
  openSession,
  seedWorkspace,
  type TestDatabase,
} from './support/database.ts';

const database: TestDatabase = await createDisposableDatabase();
const store: IdentityStoreHandle = openIdentityStore(database.runtimeUrl, {
  poolSize: 4,
});

/** How many workspace rows the database still holds for these identifiers. */
async function survivingWorkspaces(
  ids: readonly string[],
): Promise<readonly string[]> {
  const session = await openSession(database.migrationUrl);
  try {
    const rows = await session.query<{ id: string }>(
      'select id from workspaces where id = any($1::uuid[]) order by id',
      [[...ids]],
    );
    return rows.map((row) => row.id);
  } finally {
    await session.close();
  }
}

await test('the use case refuses the last workspace of an account', async () => {
  const accountId = randomUUID();
  const only = randomUUID();
  await seedWorkspace(database, only, [{ accountId, role: 'owner' }]);

  const refused = await deleteWorkspace(
    store,
    memberActor(accountId, only),
    only,
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? '' : refused.error.code, 'forbidden');
  assert.deepEqual(await survivingWorkspaces([only]), [only]);
});

await test('the database refuses the last workspace when the use case is bypassed', async () => {
  // This is the second lock of record 0051. The call goes straight to the
  // store transaction and never reaches `deleteWorkspace`, so only the SQL
  // function stands between the caller and the deletion.
  const accountId = randomUUID();
  const only = randomUUID();
  await seedWorkspace(database, only, [{ accountId, role: 'owner' }]);

  const actor = memberActor(accountId, only);
  await assert.rejects(
    () => store.workspace(actor, only, (tx) => tx.destroy()),
    (error: unknown) =>
      error instanceof Error && /last workspace/.test(error.message),
  );
  assert.deepEqual(await survivingWorkspaces([only]), [only]);
});

await test('an owner deletes a workspace while a second one remains', async () => {
  const accountId = randomUUID();
  const first = randomUUID();
  const second = randomUUID();
  await seedWorkspace(database, first, [{ accountId, role: 'owner' }]);
  await seedWorkspace(database, second, [{ accountId, role: 'owner' }]);

  const removed = await deleteWorkspace(
    store,
    memberActor(accountId, first),
    first,
  );
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.deepEqual(await survivingWorkspaces([first, second].sort()), [second]);

  // The account keeps exactly the workspace that survived, so the client has
  // somewhere to go after the delete.
  const listed = await listWorkspaces(store, memberActor(accountId, second));
  assert.equal(listed.ok, true);
  assert.deepEqual(
    listed.ok ? listed.value.map((entry) => entry.workspaceId) : [],
    [second],
  );
});

await test('the count reads this account and not the workspace table', async () => {
  // A second account holding a second workspace must not let the first account
  // delete its only one. The rule counts memberships of the caller.
  const accountId = randomUUID();
  const stranger = randomUUID();
  const mine = randomUUID();
  const theirs = randomUUID();
  await seedWorkspace(database, mine, [{ accountId, role: 'owner' }]);
  await seedWorkspace(database, theirs, [
    { accountId: stranger, role: 'owner' },
  ]);

  const refused = await deleteWorkspace(
    store,
    memberActor(accountId, mine),
    mine,
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? '' : refused.error.code, 'forbidden');
  assert.deepEqual(
    await survivingWorkspaces([mine, theirs].sort()),
    [mine, theirs].sort(),
  );
});

await store.close();
await database.destroy();
