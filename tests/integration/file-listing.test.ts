/**
 * Server-side sort and keyset paging of the file listings.
 *
 * Every check pages with a small limit and compares the pages against one
 * large page of the same listing. A keyset defect shows up exactly there: a
 * boundary that repeats a row or skips one makes the two sequences differ.
 * Files accepted by one changeset share the same acceptance instant, so the
 * tie inside the `updated` order is covered as well.
 *
 * Start the database service first:
 *
 * ```sh
 * sudo -n docker compose -f compose.test.yaml up -d --wait
 * ```
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  commitChangeset,
  listDeletedFiles,
  listFiles,
  tombstoneContent,
  type Actor,
  type FileSort,
  type RevisionInput,
} from '@notesapp/core';
import {
  createDocumentService,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import {
  changeset,
  createDisposableDatabase,
  memberActor,
  revision,
  seedWorkspace,
} from './support/database.ts';

const database = await createDisposableDatabase();
const store = openWorkspaceStore(database.runtimeUrl, createDocumentService(), {
  poolSize: 4,
});

/** One workspace with one owner, used by one check only. */
async function newWorkspace(): Promise<{
  readonly workspaceId: string;
  readonly actor: Actor;
}> {
  const workspaceId = randomUUID();
  const accountId = randomUUID();
  await seedWorkspace(database, workspaceId, [{ accountId, role: 'owner' }]);
  return { workspaceId, actor: memberActor(accountId, workspaceId) };
}

/** Accepts one changeset and fails the check when it is refused. */
async function accept(
  workspaceId: string,
  actor: Actor,
  entries: readonly RevisionInput[],
  expectedHeads?: Readonly<Record<string, string | null>>,
): Promise<void> {
  const input = changeset(workspaceId, entries, {
    ...(expectedHeads === undefined ? {} : { expectedHeads }),
  });
  const accepted = await commitChangeset(
    store,
    actor,
    input,
    `listing-${input.mutationId}`,
  );
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
}

/** Every live file of one listing, read one page of `limit` rows at a time. */
async function pagedPaths(
  workspaceId: string,
  actor: Actor,
  sort: FileSort,
  limit: number,
): Promise<readonly string[]> {
  const paths: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const answer = await listFiles(store, actor, workspaceId, {
      cursor,
      limit,
      sort,
    });
    assert.equal(answer.ok, true, JSON.stringify(answer));
    if (!answer.ok) return paths;
    assert.ok(answer.value.files.length <= limit);
    paths.push(...answer.value.files.map((file) => file.path));
    if (answer.value.nextCursor === null) return paths;
    cursor = answer.value.nextCursor;
  }
  assert.fail('the listing did not end');
}

/** Every deleted file of one listing, read one page of `limit` rows. */
async function pagedDeletedPaths(
  workspaceId: string,
  actor: Actor,
  sort: FileSort,
  limit: number,
): Promise<readonly string[]> {
  const paths: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const answer = await listDeletedFiles(store, actor, workspaceId, {
      cursor,
      limit,
      sort,
    });
    assert.equal(answer.ok, true, JSON.stringify(answer));
    if (!answer.ok) return paths;
    paths.push(...answer.value.files.map((file) => file.path));
    if (answer.value.nextCursor === null) return paths;
    cursor = answer.value.nextCursor;
  }
  assert.fail('the listing did not end');
}

/** Creates seven notes: five in one batch, then two later ones. */
async function seedNotes(
  workspaceId: string,
  actor: Actor,
): Promise<readonly { readonly fileId: string; readonly path: string }[]> {
  const batch = ['b.md', 'a.md', 'notes/d.md', 'notes/c.md', 'e.md'].map(
    (path) => ({ fileId: randomUUID(), path }),
  );
  await accept(
    workspaceId,
    actor,
    batch.map((file) => revision(file)),
  );
  const later = [{ fileId: randomUUID(), path: 'notes/f.md' }];
  await accept(
    workspaceId,
    actor,
    later.map((file) => revision(file)),
  );
  const newest = [{ fileId: randomUUID(), path: 'g.md' }];
  await accept(
    workspaceId,
    actor,
    newest.map((file) => revision(file)),
  );
  return [...batch, ...later, ...newest];
}

await test('the default listing puts the newest accepted change first', async () => {
  const { workspaceId, actor } = await newWorkspace();
  await seedNotes(workspaceId, actor);
  const answer = await listFiles(store, actor, workspaceId, {
    cursor: null,
    limit: 500,
    sort: 'updated',
  });
  assert.equal(answer.ok, true);
  if (!answer.ok) return;
  const instants = answer.value.files.map((file) => Date.parse(file.updatedAt));
  assert.equal(answer.value.files.length, 7);
  assert.equal(answer.value.files[0]?.path, 'g.md');
  assert.equal(answer.value.files[1]?.path, 'notes/f.md');
  assert.deepEqual(
    instants,
    [...instants].sort((a, b) => b - a),
  );
  // Every file carries the instant at which it was created.
  for (const file of answer.value.files)
    assert.ok(Date.parse(file.createdAt) <= Date.parse(file.updatedAt));
});

await test('the path listing orders by the stored path', async () => {
  const { workspaceId, actor } = await newWorkspace();
  await seedNotes(workspaceId, actor);
  const answer = await listFiles(store, actor, workspaceId, {
    cursor: null,
    limit: 500,
    sort: 'path',
  });
  assert.equal(answer.ok, true);
  if (!answer.ok) return;
  assert.deepEqual(
    answer.value.files.map((file) => file.path),
    ['a.md', 'b.md', 'e.md', 'g.md', 'notes/c.md', 'notes/d.md', 'notes/f.md'],
  );
});

await test('keyset paging returns each live file once in both orders', async () => {
  const { workspaceId, actor } = await newWorkspace();
  await seedNotes(workspaceId, actor);
  for (const sort of ['updated', 'path'] as const) {
    const whole = await pagedPaths(workspaceId, actor, sort, 500);
    assert.equal(whole.length, 7);
    for (const limit of [1, 2, 3, 6]) {
      const paged = await pagedPaths(workspaceId, actor, sort, limit);
      assert.deepEqual(
        paged,
        whole,
        `the ${sort} listing differs at a page size of ${limit}`,
      );
      assert.equal(new Set(paged).size, paged.length);
    }
  }
});

await test('keyset paging survives a page boundary inside one instant', async () => {
  const { workspaceId, actor } = await newWorkspace();
  // One changeset accepts every file at the same instant, so the whole
  // listing is one tie and only the file identifier breaks it.
  const batch = ['one.md', 'two.md', 'three.md', 'four.md'].map((path) => ({
    fileId: randomUUID(),
    path,
  }));
  await accept(
    workspaceId,
    actor,
    batch.map((file) => revision(file)),
  );
  const whole = await pagedPaths(workspaceId, actor, 'updated', 500);
  assert.equal(new Set(whole).size, 4);
  for (const limit of [1, 2, 3])
    assert.deepEqual(
      await pagedPaths(workspaceId, actor, 'updated', limit),
      whole,
    );
});

await test('the trash pages by the same keyset in both orders', async () => {
  const { workspaceId, actor } = await newWorkspace();
  const notes = await seedNotes(workspaceId, actor);
  for (const note of notes) {
    const head = await store.transact(actor, workspaceId, (tx) =>
      tx.file(note.fileId),
    );
    const parent = head?.headRevisionId ?? '';
    const stored = await store.transact(actor, workspaceId, (tx) =>
      tx.revision(parent),
    );
    assert.ok(stored !== null);
    await accept(
      workspaceId,
      actor,
      [
        revision({
          fileId: note.fileId,
          parents: [parent],
          path: note.path,
          deleted: true,
          content: await tombstoneContent({
            kind: 'markdown',
            digest: stored.digest,
            text: stored.text ?? '',
          }),
        }),
      ],
      { [note.fileId]: parent },
    );
  }
  for (const sort of ['updated', 'path'] as const) {
    const whole = await pagedDeletedPaths(workspaceId, actor, sort, 500);
    assert.equal(whole.length, notes.length);
    assert.deepEqual(
      await pagedDeletedPaths(workspaceId, actor, sort, 2),
      whole,
    );
  }
  // A deleted file leaves the live listing.
  assert.deepEqual(await pagedPaths(workspaceId, actor, 'updated', 500), []);
});

await store.close();
await database.destroy();
