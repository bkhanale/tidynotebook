/**
 * Local drafts, immutable checkpoints, and the sync queue.
 *
 * Dexie runs against `fake-indexeddb` here, injected through the Dexie
 * constructor options. That proves the transaction boundaries, the partition
 * keys, the local branch rule, and the failure kinds of this code. It does not
 * prove real browser durability: eviction, persistent storage permission,
 * private mode limits, and actual quota behavior differ per browser and per
 * device, and remain evidence for the authorized device stage.
 *
 * Every test builds its own `IDBFactory`, so runs never share state.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import test from 'node:test';
import { IDBFactory, IDBKeyRange as FakeKeyRange } from 'fake-indexeddb';
import {
  contentDigest,
  type AcceptedChangeset,
  type AcceptedRevision,
} from '@notesapp/core';
import {
  isLocalStorageError,
  LocalStorageError,
  parkRefusedSave,
  type Draft,
  type LocalChange,
  type LocalStore,
  type QueueEntry,
} from '@notesapp/sync';
import {
  createDatabase,
  metaKey,
  openLocalStore,
  partitionRange,
  type LocalStoreOptions,
  type MetaRow,
} from '@notesapp/storage-browser';

const origin = 'https://notes.example.test';

/** A counted clock, so every record carries a distinct client time. */
function createClock(): () => number {
  let current = Date.parse('2026-09-06T10:00:00.000Z');
  return () => {
    current += 1000;
    return current;
  };
}

/** A counted identifier source, so a failure names the record that differs. */
function createIds(prefix: string): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
  };
}

/** One isolated database and the options that open it. */
type Backend = {
  readonly name: string;
  readonly factory: IDBFactory;
  options: (extra?: Partial<LocalStoreOptions>) => LocalStoreOptions;
};

function createBackend(prefix: string): Backend {
  const factory = new IDBFactory();
  const name = `notesapp-${prefix}`;
  return {
    name,
    factory,
    options: (extra = {}) => ({
      indexedDB: factory,
      IDBKeyRange: FakeKeyRange,
      databaseName: name,
      now: createClock(),
      id: createIds(prefix),
      deviceId: `device-${prefix}`,
      ...extra,
    }),
  };
}

/** One editor working copy of one note. */
function draftOf(
  accountId: string,
  workspaceId: string,
  fileId: string,
  workingCopyId: string,
  text: string,
  extra: Partial<Draft> = {},
): Draft {
  return {
    accountId,
    workspaceId,
    workingCopyId,
    fileId,
    baseRevisionId: null,
    text,
    path: 'notes/one.md',
    deleted: false,
    sequence: 1,
    ...extra,
  };
}

/** Accepts every revision of a queued mutation, as the server would. */
function acceptanceOf(
  entry: QueueEntry | null,
  accountId: string,
  cursor: string,
): AcceptedChangeset {
  assert.ok(entry !== null, 'the mutation must be queued');
  const revisions: AcceptedRevision[] = entry.input.revisions.map(
    (revision) => ({
      revisionId: revision.id,
      fileId: revision.fileId,
      parents: revision.parents,
      path: revision.path,
      deleted: revision.deleted,
      digest: revision.content.digest,
      size:
        revision.content.kind === 'markdown'
          ? new TextEncoder().encode(revision.content.text).byteLength
          : 0,
      actorAccountId: accountId,
      serverTime: '2026-09-06T12:00:00.000Z',
      message: revision.message,
    }),
  );
  return {
    mutationId: entry.input.mutationId,
    revisionIds: revisions.map((revision) => revision.revisionId),
    cursor,
    revisions,
    superseded: [],
  };
}

/**
 * Wraps an IndexedDB factory so one store method fails on demand.
 *
 * A browser reports a full profile as a `QuotaExceededError` and a refused
 * transaction as an abort. `fake-indexeddb` simulates neither, so the test
 * injects the failure at the store boundary and checks that the whole
 * transaction rolls back and that the caller receives the right kind.
 */
function createFailingFactory(
  base: IDBFactory,
  failure: () => {
    store: string;
    method: string;
    error: Error;
    reject?: (args: readonly unknown[]) => boolean;
  } | null,
): IDBFactory {
  const bind = (target: object, property: string | symbol): unknown => {
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  const wrapStore = (store: IDBObjectStore): IDBObjectStore =>
    new Proxy(store, {
      get(target, property) {
        const chosen = failure();
        if (
          chosen !== null &&
          chosen.store === target.name &&
          chosen.method === property
        )
          return (...args: readonly unknown[]): unknown => {
            if (chosen.reject === undefined || chosen.reject(args))
              throw chosen.error;
            const method: unknown = Reflect.get(target, property, target);
            if (typeof method !== 'function') return method;
            return Reflect.apply(method, target, args);
          };
        return bind(target, property);
      },
    });
  // Dexie builds its storage stack from `transaction.db`, so the wrapper has
  // to travel back through that member as well.
  const wrapTransaction = (transaction: IDBTransaction): IDBTransaction =>
    new Proxy(transaction, {
      get(target, property) {
        if (property === 'objectStore')
          return (name: string) => wrapStore(target.objectStore(name));
        if (property === 'db') return wrapDatabase(target.db);
        return bind(target, property);
      },
    });
  const wrapDatabase = (database: IDBDatabase): IDBDatabase =>
    new Proxy(database, {
      get(target, property) {
        if (property === 'transaction')
          return (
            names: string | readonly string[],
            mode?: IDBTransactionMode,
          ) =>
            wrapTransaction(
              mode === undefined
                ? target.transaction(names as string[])
                : target.transaction(names as string[], mode),
            );
        return bind(target, property);
      },
    });
  return new Proxy(base, {
    get(target, property) {
      if (property !== 'open') return bind(target, property);
      return (name: string, version?: number): IDBOpenDBRequest => {
        const request =
          version === undefined
            ? target.open(name)
            : target.open(name, version);
        return new Proxy(request, {
          get(requestTarget, requestProperty) {
            if (requestProperty === 'result') {
              const result: unknown = requestTarget.result;
              return result instanceof Object
                ? wrapDatabase(requestTarget.result)
                : result;
            }
            return bind(requestTarget, requestProperty);
          },
          set(requestTarget, requestProperty, value: unknown) {
            return Reflect.set(requestTarget, requestProperty, value);
          },
        });
      };
    },
  });
}

/** Reads rows that the port does not expose, for storage level checks. */
async function withRawDatabase<T>(
  backend: Backend,
  run: (tables: ReturnType<typeof createDatabase>['tables']) => Promise<T>,
): Promise<T> {
  const { db, tables } = createDatabase(backend.name, {
    indexedDB: backend.factory,
    IDBKeyRange: FakeKeyRange,
  });
  await db.open();
  try {
    return await run(tables);
  } finally {
    db.close();
  }
}

await test('a draft save and a checkpoint commit as one transaction each', async () => {
  const backend = createBackend('basic');
  const store: LocalStore = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const draft = draftOf(account, workspace, file, 'copy-a', '# One\n');

  await store.saveDraft(draft);
  assert.deepEqual(await store.readDraft(account, workspace, 'copy-a'), draft);
  assert.deepEqual(await store.readCachedNote(account, workspace, file), {
    fileId: file,
    path: 'notes/one.md',
    text: '# One\n',
    deleted: false,
    workingCopyId: 'copy-a',
    sequence: 1,
    baseRevisionId: null,
    stale: false,
    acceptedText: null,
    acceptedPath: null,
    acceptedRevisionId: null,
  });

  const entry = await store.checkpoint(draft, null);
  assert.notEqual(entry, null);
  assert.equal(entry?.state, 'pending');
  assert.equal(entry?.digest, null);
  assert.equal(entry?.input.deviceId, 'device-basic');
  // A file the server has not accepted yet must not exist there.
  assert.deepEqual(entry?.input.expectedHeads, { [file]: null });
  const revision = entry?.input.revisions[0];
  assert.equal(revision?.parents.length, 0);
  assert.equal(revision?.content.digest, await contentDigest('# One\n'));

  const checkpoints = await store.listCheckpoints(account, workspace, file);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0]?.accepted, false);
  assert.equal(checkpoints[0]?.message, null);
  assert.deepEqual(await store.pending(account, workspace), [entry]);
  await store.close();
});

await test('a deletion checkpoint submits a tombstone with no text', async () => {
  const backend = createBackend('tombstone');
  const store: LocalStore = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const draft = draftOf(account, workspace, file, 'copy-a', '# Body\n');

  await store.saveDraft(draft);
  assert.notEqual(await store.checkpoint(draft, null), null);

  const removed = { ...draft, deleted: true, sequence: 2 };
  await store.saveDraft(removed);
  const entry = await store.checkpoint(removed, null);
  const revision = entry?.input.revisions[0];
  assert.equal(revision?.deleted, true);
  // The server refuses a deletion that submits Markdown, so the tombstone
  // carries the empty text and the digest of the empty text.
  assert.equal(
    revision?.content.kind === 'markdown' ? revision.content.text : null,
    '',
  );
  assert.equal(revision?.content.digest, await contentDigest(''));
  await store.close();
});

await test('an unchanged checkpoint is suppressed and a named one is not', async () => {
  const backend = createBackend('unchanged');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const draft = draftOf(account, workspace, file, 'copy-a', 'text\n');

  await store.saveDraft(draft);
  assert.notEqual(await store.checkpoint(draft, null), null);
  assert.equal(await store.checkpoint(draft, null), null);
  assert.notEqual(await store.checkpoint(draft, 'before the rewrite'), null);

  const changed = { ...draft, text: 'text and more\n', sequence: 2 };
  await store.saveDraft(changed);
  assert.notEqual(await store.checkpoint(changed, null), null);

  const checkpoints = await store.listCheckpoints(account, workspace, file);
  assert.deepEqual(
    checkpoints.map((entry) => entry.message),
    [null, 'before the rewrite', null],
  );
  // Every checkpoint after the first has exactly one parent, and it is the
  // previous checkpoint of the same working copy.
  assert.deepEqual(checkpoints[1]?.parents, [checkpoints[0]?.revisionId]);
  assert.deepEqual(checkpoints[2]?.parents, [checkpoints[1]?.revisionId]);
  await store.close();
});

await test('an unchanged working copy of an accepted file writes nothing', async () => {
  const backend = createBackend('accepted');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const first = draftOf(account, workspace, file, 'copy-a', 'body\n');
  await store.saveDraft(first);
  const entry = await store.checkpoint(first, null);
  const revisionId = entry?.input.revisions[0]?.id ?? '';
  await store.acknowledge(account, acceptanceOf(entry, account, '10'));
  await withRawDatabase(backend, async (tables) => {
    await tables.drafts.delete([origin, account, workspace, 'copy-a']);
  });
  assert.deepEqual(await store.readCachedNote(account, workspace, file), {
    fileId: file,
    path: 'notes/one.md',
    text: 'body\n',
    deleted: false,
    sequence: 0,
    baseRevisionId: revisionId,
    stale: false,
    acceptedText: null,
    acceptedPath: 'notes/one.md',
    acceptedRevisionId: revisionId,
  });

  // A second tab opens the accepted head and leaves without typing.
  const reopened = draftOf(account, workspace, file, 'copy-b', 'body\n', {
    baseRevisionId: revisionId,
  });
  await store.saveDraft(reopened);
  assert.equal(await store.checkpoint(reopened, null), null);
  assert.deepEqual(await store.pending(account, workspace), []);
  await store.close();
});

await test('a cached local deletion does not reopen accepted content', async () => {
  const backend = createBackend('deleted-cache');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const deleted = {
    ...draftOf(account, workspace, file, 'copy-a', 'old body\n'),
    deleted: true,
  };

  await store.saveDraft(deleted);

  assert.deepEqual(await store.readCachedNote(account, workspace, file), {
    fileId: file,
    path: 'notes/one.md',
    text: 'old body\n',
    deleted: true,
    workingCopyId: 'copy-a',
    sequence: 1,
    baseRevisionId: null,
    stale: false,
    acceptedText: null,
    acceptedPath: null,
    acceptedRevisionId: null,
  });
  await store.close();
});

await test('two working copies of one file create ordered local saves', async () => {
  const backend = createBackend('branch');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  const base = draftOf(account, workspace, file, 'copy-a', 'start\n');
  await store.saveDraft(base);
  const first = await store.checkpoint(base, null);
  const firstRevision = first?.input.revisions[0]?.id ?? '';
  await store.acknowledge(account, acceptanceOf(first, account, '11'));

  // Two tabs open the same accepted head and both edit it.
  const tabA = draftOf(account, workspace, file, 'copy-a2', 'start and A\n', {
    baseRevisionId: firstRevision,
  });
  const tabB = draftOf(account, workspace, file, 'copy-b2', 'start and B\n', {
    baseRevisionId: firstRevision,
  });
  await store.saveDraft(tabA);
  await store.saveDraft(tabB);
  const fromA = await store.checkpoint(tabA, null);
  const fromB = await store.checkpoint(tabB, null);
  const revisionA = fromA?.input.revisions[0]?.id ?? '';
  const revisionB = fromB?.input.revisions[0]?.id ?? '';
  assert.notEqual(revisionA, revisionB);
  // Both name the accepted head that their tab read. The server rebases the
  // later save on the earlier one and reports the head that it passed, so the
  // person is told that the text of the first tab moved into history.
  assert.deepEqual(fromA?.input.revisions[0]?.parents, [firstRevision]);
  assert.deepEqual(fromB?.input.revisions[0]?.parents, [firstRevision]);

  const file2 = await withRawDatabase(backend, (tables) =>
    tables.acceptedFiles.get([origin, account, workspace, file]),
  );
  // The newest local save is the local head, and both texts are kept: the
  // first tab's checkpoint stays until the server acknowledges it.
  assert.equal(file2?.localHeadRevisionId, revisionB);
  assert.equal(file2?.acceptedHeadRevisionId, firstRevision);
  const kept = await store.listCheckpoints(account, workspace, file);
  assert.deepEqual(
    kept.map((checkpoint) => checkpoint.revisionId).sort(),
    [firstRevision, revisionA, revisionB].sort(),
  );

  await store.markSending(
    account,
    fromA?.input.mutationId ?? '',
    'branch-a-digest',
  );
  await store.acknowledge(account, acceptanceOf(fromA, account, '12'));
  const sibling = (await store.pending(account, workspace)).find(
    (entry) => entry.input.mutationId === fromB?.input.mutationId,
  );
  // The later save remains queued with the accepted head that it observed.
  // Its precondition is not advanced here, because its revision is not a
  // child of the accepted revision. The server therefore rebases it and
  // reports the head of the first tab as superseded.
  assert.deepEqual(sibling?.input.expectedHeads, {
    [file]: firstRevision,
  });

  // The precondition moves to the head that the server accepted, exactly as
  // the sync engine does after a refused precondition.
  const moved = await store.reparentQueueEntry(
    account,
    fromB?.input.mutationId ?? '',
    { [file]: revisionA },
  );
  assert.deepEqual(moved?.input.expectedHeads, { [file]: revisionA });
  assert.equal(moved?.state, 'pending');
  assert.equal(moved?.digest, null);
  await store.close();
});

await test('a discarded deletion leaves the note in its accepted state', async () => {
  const backend = createBackend('discard');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  const base = draftOf(account, workspace, file, 'copy-a', 'body\n');
  await store.saveDraft(base);
  const created = await store.checkpoint(base, null);
  const acceptedHead = created?.input.revisions[0]?.id ?? '';
  await store.acknowledge(account, acceptanceOf(created, account, '10'));

  // The person deletes the note, and the server refuses the deletion because
  // the note changed on another device.
  const removal = {
    ...draftOf(account, workspace, file, 'copy-a', '', {
      baseRevisionId: acceptedHead,
      sequence: 2,
    }),
    deleted: true,
  };
  await store.saveDraft(removal);
  const queued = await store.checkpoint(removal, null);
  assert.ok(queued !== null);
  await store.discardQueueEntry(account, queued.input.mutationId);

  assert.deepEqual(await store.pending(account, workspace), []);
  const kept = await store.listCheckpoints(account, workspace, file);
  assert.deepEqual(
    kept.map((checkpoint) => checkpoint.revisionId),
    [acceptedHead],
  );
  const row = await withRawDatabase(backend, (tables) =>
    tables.acceptedFiles.get([origin, account, workspace, file]),
  );
  assert.equal(row?.deleted, false);
  assert.equal(row?.localHeadRevisionId, acceptedHead);
  assert.equal(row?.acceptedHeadRevisionId, acceptedHead);
  // The tombstone draft that recorded the refused deletion is gone, so it
  // cannot shadow the note that stays live.
  assert.equal(await store.readDraft(account, workspace, 'copy-a'), null);
  const drafts = await withRawDatabase(backend, (tables) =>
    tables.drafts
      .where('[serverOrigin+accountId+workspaceId+fileId]')
      .equals([origin, account, workspace, file])
      .toArray(),
  );
  assert.deepEqual(drafts, []);
  await store.close();
});

await test('a failed transaction leaves no checkpoint, content, or queue entry', async () => {
  const backend = createBackend('abort');
  let failing = false;
  const factory = createFailingFactory(backend.factory, () =>
    failing
      ? {
          store: 'queue',
          method: 'add',
          error: new DOMException('forced abort', 'AbortError'),
        }
      : null,
  );
  const store = await openLocalStore(
    origin,
    backend.options({ indexedDB: factory }),
  );
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const draft = draftOf(account, workspace, file, 'copy-a', 'first\n');
  await store.saveDraft(draft);
  const accepted = await store.checkpoint(draft, null);
  assert.notEqual(accepted, null);

  failing = true;
  const changed = { ...draft, text: 'second\n', sequence: 2 };
  await store.saveDraft(changed);
  const error: unknown = await store.checkpoint(changed, null).then(
    () => null,
    (reason: unknown) => reason,
  );
  assert.ok(isLocalStorageError(error), 'the failure must be typed');
  assert.equal(error.kind, 'aborted');

  failing = false;
  // The first checkpoint is intact and the failed one wrote nothing.
  const checkpoints = await store.listCheckpoints(account, workspace, file);
  assert.equal(checkpoints.length, 1);
  assert.equal((await store.pending(account, workspace)).length, 1);
  const digests = await withRawDatabase(backend, async (tables) => {
    const range = partitionRange(origin, account, workspace);
    const rows = await tables.contents
      .where('[serverOrigin+accountId+workspaceId+digest]')
      .between(range.lower, range.upper, true, true)
      .toArray();
    return rows.map((row) => row.digest);
  });
  assert.deepEqual(digests, [await contentDigest('first\n')]);
  await store.close();
});

await test('a full profile reports the quota failure kind', async () => {
  const backend = createBackend('quota');
  let failing = false;
  const factory = createFailingFactory(backend.factory, () =>
    failing
      ? {
          store: 'contents',
          method: 'put',
          error: new DOMException('no space left', 'QuotaExceededError'),
        }
      : null,
  );
  const store = await openLocalStore(
    origin,
    backend.options({ indexedDB: factory }),
  );
  const account = randomUUID();
  const workspace = randomUUID();
  const draft = draftOf(account, workspace, randomUUID(), 'copy-a', 'a note\n');
  await store.saveDraft(draft);
  failing = true;
  const error: unknown = await store.checkpoint(draft, null).then(
    () => null,
    (reason: unknown) => reason,
  );
  assert.ok(isLocalStorageError(error));
  assert.equal(error.kind, 'quota');
  // The message names the operation and carries no note text.
  assert.match(error.message, /creating a checkpoint/u);
  assert.doesNotMatch(error.message, /a note/u);
  failing = false;
  assert.deepEqual(await store.pending(account, workspace), []);
  await store.close();
});

await test('acknowledgment preserves later drafts and checkpoints', async () => {
  const backend = createBackend('ack');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const draft = draftOf(account, workspace, file, 'copy-a', 'one\n');
  await store.saveDraft(draft);
  const submitted = await store.checkpoint(draft, null);
  const submittedRevision = submitted?.input.revisions[0]?.id ?? '';
  const mutationId = submitted?.input.mutationId ?? '';

  // The user keeps typing while the mutation is in flight.
  const later = { ...draft, text: 'one and two\n', sequence: 2 };
  await store.saveDraft(later);
  const laterEntry = await store.checkpoint(later, null);
  assert.notEqual(laterEntry, null);
  assert.equal(laterEntry?.state, 'pending');
  assert.deepEqual(laterEntry?.input.expectedHeads, { [file]: null });
  assert.deepEqual(laterEntry?.input.revisions[0]?.parents, [
    submittedRevision,
  ]);

  await store.markSending(account, mutationId, 'digest-1');
  const sending = await store.pending(account, workspace);
  assert.equal(sending[0]?.state, 'sending');
  assert.equal(sending[0]?.digest, 'digest-1');
  // The digest freezes: a second send cannot describe another request.
  await store.markSending(account, mutationId, 'digest-2');
  assert.equal(
    (await store.pending(account, workspace))[0]?.digest,
    'digest-1',
  );

  await store.acknowledge(account, acceptanceOf(submitted, account, '42'));
  const remaining = await store.pending(account, workspace);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.input.mutationId, laterEntry?.input.mutationId);
  assert.deepEqual(remaining[0]?.input.expectedHeads, {
    [file]: submittedRevision,
  });

  const checkpoints = await store.listCheckpoints(account, workspace, file);
  assert.deepEqual(
    checkpoints.map((entry) => entry.accepted),
    [true, false],
  );
  assert.deepEqual(await store.readDraft(account, workspace, 'copy-a'), later);

  const record = await withRawDatabase(backend, (tables) =>
    tables.acceptedFiles.get([origin, account, workspace, file]),
  );
  assert.equal(record?.acceptedHeadRevisionId, submittedRevision);
  // The local head still names the newer checkpoint.
  assert.equal(record?.localHeadRevisionId, laterEntry?.input.revisions[0]?.id);
  await store.close();
});

await test('acknowledging one mutation twice changes nothing', async () => {
  const backend = createBackend('replay');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const draft = draftOf(account, workspace, file, 'copy-a', 'one\n');
  await store.saveDraft(draft);
  const entry = await store.checkpoint(draft, null);
  const result = acceptanceOf(entry, account, '7');

  await store.acknowledge(account, result);
  const afterFirst = await withRawDatabase(backend, (tables) =>
    tables.acceptedFiles.get([origin, account, workspace, file]),
  );
  await store.acknowledge(account, result);
  const afterSecond = await withRawDatabase(backend, (tables) =>
    tables.acceptedFiles.get([origin, account, workspace, file]),
  );
  assert.deepEqual(afterSecond, afterFirst);
  assert.deepEqual(await store.pending(account, workspace), []);
  assert.equal(
    (await store.listCheckpoints(account, workspace, file)).length,
    1,
  );
  await store.close();
});

await test('one account cannot see the records of another', async () => {
  const backend = createBackend('partition');
  const store = await openLocalStore(origin, backend.options());
  const accountA = randomUUID();
  const accountB = randomUUID();
  const workspace = randomUUID();
  const otherWorkspace = randomUUID();
  const file = randomUUID();

  const draft = draftOf(accountA, workspace, file, 'copy-a', 'private\n');
  await store.saveDraft(draft);
  await store.checkpoint(draft, null);

  assert.equal(await store.readDraft(accountB, workspace, 'copy-a'), null);
  assert.equal(await store.readDraft(accountA, otherWorkspace, 'copy-a'), null);
  assert.deepEqual(await store.pending(accountB, workspace), []);
  assert.deepEqual(await store.pending(accountA, otherWorkspace), []);
  assert.deepEqual(await store.listCheckpoints(accountB, workspace, file), []);
  assert.deepEqual(await store.recover(accountB, workspace), []);

  // The other account also cannot change a mutation it can name.
  const entries = await store.pending(accountA, workspace);
  const mutationId = entries[0]?.input.mutationId ?? '';
  await store.markConflict(accountB, mutationId);
  assert.equal((await store.pending(accountA, workspace))[0]?.state, 'pending');
  await store.markConflict(accountA, mutationId);
  assert.equal(
    (await store.pending(accountA, workspace))[0]?.state,
    'conflict',
  );
  await store.close();
});

await test('an interrupted migration is completed on the next open', async () => {
  const backend = createBackend('migration');
  const first = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const draft = draftOf(account, workspace, file, 'copy-a', 'kept\n');
  await first.saveDraft(draft);
  await first.checkpoint(draft, null);
  await first.close();

  await withRawDatabase(backend, async (tables) => {
    const meta = await tables.meta.get(metaKey);
    assert.equal(meta?.migrationState, 'complete');
    await tables.meta.put({
      ...(meta as MetaRow),
      migrationState: 'in-progress',
    });
  });

  const second = await openLocalStore(origin, backend.options());
  const repaired = await withRawDatabase(backend, (tables) =>
    tables.meta.get(metaKey),
  );
  assert.equal(repaired?.migrationState, 'complete');
  // Pending work survived the repair.
  assert.equal((await second.pending(account, workspace)).length, 1);
  assert.deepEqual(await second.readDraft(account, workspace, 'copy-a'), draft);
  await second.close();
});

/** The requested row count of an IndexedDB getAll call. */
function getAllCount(args: readonly unknown[]): number | null {
  const count = args[1];
  if (typeof count === 'number') return count;
  const options = args[0];
  if (typeof options !== 'object' || options === null) return null;
  const optionCount: unknown = Reflect.get(options, 'count');
  return typeof optionCount === 'number' ? optionCount : null;
}

await test('migration repair validates records in bounded batches', async () => {
  const backend = createBackend('cursor-migration');
  const first = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  for (let index = 0; index < 120; index += 1)
    await first.saveDraft(
      draftOf(
        account,
        workspace,
        randomUUID(),
        `copy-${String(index)}`,
        `kept ${String(index)}\n`,
      ),
    );
  await first.close();

  await withRawDatabase(backend, async (tables) => {
    const meta = await tables.meta.get(metaKey);
    assert.ok(meta !== undefined);
    await tables.meta.put({ ...meta, migrationState: 'in-progress' });
  });

  let migrationIsRunning = true;
  const noWholeDraftRead = createFailingFactory(backend.factory, () =>
    migrationIsRunning
      ? {
          store: 'drafts',
          method: 'getAll',
          error: new Error('migration read an unbounded drafts batch'),
          reject: (args) => {
            const count = getAllCount(args);
            return count === null || count > 100;
          },
        }
      : null,
  );
  const repaired = await openLocalStore(
    origin,
    backend.options({ indexedDB: noWholeDraftRead }),
  );
  migrationIsRunning = false;
  assert.equal((await repaired.listLocalFiles(account, workspace)).length, 120);
  await repaired.close();
});

await test('a database this application cannot read is refused', async () => {
  const newer = createBackend('newer');
  const opened = await openLocalStore(origin, newer.options());
  await opened.close();
  await withRawDatabase(newer, async (tables) => {
    const meta = await tables.meta.get(metaKey);
    await tables.meta.put({ ...(meta as MetaRow), schemaVersion: 99 });
  });
  await assert.rejects(
    openLocalStore(origin, newer.options()),
    (error: unknown) =>
      error instanceof LocalStorageError && error.kind === 'corrupt',
  );

  const broken = createBackend('broken');
  const store = await openLocalStore(origin, broken.options());
  const account = randomUUID();
  const workspace = randomUUID();
  await store.saveDraft(
    draftOf(account, workspace, randomUUID(), 'copy-a', 'text\n'),
  );
  await store.close();
  await withRawDatabase(broken, async (tables) => {
    const meta = await tables.meta.get(metaKey);
    await tables.meta.put({
      ...(meta as MetaRow),
      migrationState: 'in-progress',
    });
    // A record whose shape this application does not accept.
    const rows = await tables.drafts.toArray();
    const row = rows[0];
    assert.ok(row !== undefined);
    await tables.drafts.put({ ...row, sequence: Number.NaN });
  });
  await assert.rejects(
    openLocalStore(origin, broken.options()),
    (error: unknown) =>
      error instanceof LocalStorageError && error.kind === 'corrupt',
  );
});

await test('local save and cached opening stay inside their targets', async () => {
  const backend = createBackend('latency');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  // A typical note in the design's corpus is 5 to 20 KiB.
  const body = 'The quick brown fox jumps over the lazy dog.\n'.repeat(300);
  const saveSamples: number[] = [];
  for (let index = 0; index < 60; index += 1) {
    const draft = draftOf(
      account,
      workspace,
      file,
      'copy-a',
      `${body}${String(index)}\n`,
      { sequence: index + 1 },
    );
    const started = performance.now();
    await store.saveDraft(draft);
    saveSamples.push(performance.now() - started);
  }
  const readSamples: number[] = [];
  for (let index = 0; index < 60; index += 1) {
    const started = performance.now();
    const cached = await store.readCachedNote(account, workspace, file);
    readSamples.push(performance.now() - started);
    assert.equal(cached?.text.endsWith(`${String(59)}\n`), true);
  }
  saveSamples.sort((left, right) => left - right);
  readSamples.sort((left, right) => left - right);
  const at = (samples: readonly number[], fraction: number): number =>
    samples[
      Math.min(samples.length - 1, Math.ceil(samples.length * fraction) - 1)
    ] ?? 0;
  process.stdout.write(
    `draft save over ${String(saveSamples.length)} runs: p50 ${at(saveSamples, 0.5).toFixed(2)} ms, ` +
      `p95 ${at(saveSamples, 0.95).toFixed(2)} ms, max ${(saveSamples.at(-1) ?? 0).toFixed(2)} ms ` +
      `(fake-indexeddb in Node, not browser durability)\n`,
  );
  process.stdout.write(
    `cached note open over ${String(readSamples.length)} runs: p50 ${at(readSamples, 0.5).toFixed(2)} ms, ` +
      `p95 ${at(readSamples, 0.95).toFixed(2)} ms, max ${(readSamples.at(-1) ?? 0).toFixed(2)} ms ` +
      `(fake-indexeddb in Node, not a browser paint)\n`,
  );
  assert.ok(
    at(saveSamples, 0.95) < 150,
    `the save target is 150 ms, measured ${at(saveSamples, 0.95).toFixed(2)} ms`,
  );
  assert.ok(
    at(readSamples, 0.95) < 150,
    `the cached open target is 150 ms, measured ${at(readSamples, 0.95).toFixed(2)} ms`,
  );
  await store.close();
});

await test('local files and save state follow committed writes per file', async () => {
  const backend = createBackend('reactive-files');
  const store = await openLocalStore(origin, backend.options());
  const otherStore = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const firstFile = randomUUID();
  const secondFile = randomUUID();
  const changes: string[] = [];
  const otherChanges: string[] = [];
  const unsubscribe = store.subscribe((change) => {
    changes.push(`${change.kind}:${change.fileId ?? 'workspace'}`);
  });
  const unsubscribeOther = otherStore.subscribe((change) => {
    otherChanges.push(`${change.kind}:${change.fileId ?? 'workspace'}`);
  });
  const first = draftOf(account, workspace, firstFile, 'copy-a', 'first\n', {
    sequence: 1,
  });
  const second = draftOf(account, workspace, secondFile, 'copy-b', 'second\n', {
    path: 'notes/two.md',
    sequence: 1,
  });
  await store.saveDraft(first);
  await store.saveDraft(second);
  assert.deepEqual(
    (await store.listLocalFiles(account, workspace)).map((file) => file.path),
    ['notes/one.md', 'notes/two.md'],
  );
  assert.equal(
    (await store.readFileSaveSnapshot(account, workspace, firstFile))
      .hasUncheckpointedDraft,
    true,
  );
  const queued = await store.checkpoint(first, null);
  assert.ok(queued !== null);
  const firstState = await store.readFileSaveSnapshot(
    account,
    workspace,
    firstFile,
  );
  const secondState = await store.readFileSaveSnapshot(
    account,
    workspace,
    secondFile,
  );
  assert.equal(firstState.latestMutationId, queued.input.mutationId);
  assert.equal(firstState.queueState, 'pending');
  assert.equal(firstState.hasUncheckpointedDraft, false);
  assert.equal(secondState.latestMutationId, null);
  assert.equal(secondState.hasUncheckpointedDraft, true);
  assert.deepEqual(changes, [
    `draft:${firstFile}`,
    `draft:${secondFile}`,
    `queue:${firstFile}`,
  ]);
  assert.deepEqual(otherChanges, changes);
  unsubscribe();
  unsubscribeOther();
  await otherStore.close();
  await store.close();
});

await test('an uncheckpointed draft still describes a note that is in sync', async () => {
  const backend = createBackend('leading-draft');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const fileId = randomUUID();
  const draft = draftOf(account, workspace, fileId, 'copy-a', 'saved\n');
  await store.saveDraft(draft);
  const queued = await store.checkpoint(draft, null);
  await store.acknowledge(account, acceptanceOf(queued, account, '2'));
  // Typing writes a draft and no checkpoint, so the accepted head does not
  // move. The text must survive a reload.
  await store.saveDraft({ ...draft, text: 'typed\n', sequence: 2 });

  const cached = await store.readCachedNote(account, workspace, fileId);
  assert.equal(cached?.text, 'typed\n');
  assert.deepEqual(
    (await store.listLocalFiles(account, workspace)).map((file) => file.path),
    ['notes/one.md'],
  );
  await store.close();
});

await test('a purge marker drops the note from the local file list', async () => {
  const backend = createBackend('purged-file');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const fileId = randomUUID();
  const draft = draftOf(account, workspace, fileId, 'copy-a', 'purge me\n');
  await store.saveDraft(draft);
  const queued = await store.checkpoint(draft, null);
  await store.acknowledge(account, acceptanceOf(queued, account, '7'));
  assert.deepEqual(
    (await store.listLocalFiles(account, workspace)).map((file) => file.fileId),
    [fileId],
  );

  // The ordered feed carries a purge as a file record with no revision, so
  // the local cache learns that the note is gone for good.
  await store.applyRemoteChanges(
    account,
    workspace,
    [{ file: null, purgedFileId: fileId }],
    '8',
  );

  assert.deepEqual(await store.listLocalFiles(account, workspace), []);
  assert.deepEqual(await store.listAcceptedFiles(account, workspace), []);
  assert.deepEqual(await store.listSearchFiles(account, workspace), []);
  assert.equal(await store.readCursor(account, workspace), '8');
  await store.close();
});

await test('a restore from the server puts a deleted note back in the tree', async () => {
  const backend = createBackend('restored-file');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const fileId = randomUUID();
  const draft = draftOf(account, workspace, fileId, 'copy-a', 'keep me\n');
  await store.saveDraft(draft);
  const saved = await store.checkpoint(draft, null);
  await store.acknowledge(account, acceptanceOf(saved, account, '3'));
  const removed = await store.checkpoint(
    { ...draft, deleted: true, text: '', sequence: 2 },
    null,
  );
  await store.acknowledge(account, acceptanceOf(removed, account, '4'));
  assert.deepEqual(
    (await store.listLocalFiles(account, workspace)).map(
      (file) => file.deleted,
    ),
    [true],
  );

  const digest = await contentDigest('keep me\n');
  await store.applyRemoteChanges(
    account,
    workspace,
    [
      {
        file: {
          fileId,
          revisionId: 'restore-revision',
          path: 'notes/one.md',
          fileKind: 'note',
          deleted: false,
          digest,
          text: 'keep me\n',
        },
        purgedFileId: null,
      },
    ],
    '5',
  );

  const listed = await store.listLocalFiles(account, workspace);
  assert.deepEqual(
    listed.map((file) => ({ fileId: file.fileId, deleted: file.deleted })),
    [{ fileId, deleted: false }],
  );
  assert.deepEqual(
    (await store.listSearchFiles(account, workspace)).map((file) => file.path),
    ['notes/one.md'],
  );
  // The note opens with its content again: the draft of the deletion no
  // longer describes the file, because the server moved past it.
  const cached = await store.readCachedNote(account, workspace, fileId);
  assert.equal(cached?.deleted, false);
  assert.equal(cached?.text, 'keep me\n');
  await store.close();
});

await test('a restore reaches a device whose deletion draft holds the text', async () => {
  const backend = createBackend('restored-with-draft');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const fileId = randomUUID();
  const draft = draftOf(account, workspace, fileId, 'copy-a', 'keep me\n');
  await store.saveDraft(draft);
  const saved = await store.checkpoint(draft, null);
  await store.acknowledge(account, acceptanceOf(saved, account, '3'));

  // The editor deletes the note it has open, so the deletion draft keeps the
  // buffer while the tombstone revision carries no text.
  const removal = { ...draft, deleted: true, sequence: 2 };
  await store.saveDraft(removal);
  const removed = await store.checkpoint(removal, null);
  await store.acknowledge(account, acceptanceOf(removed, account, '4'));
  // The accepted head is the tombstone, so the accepted file states the
  // deletion. Nothing local moved past it.
  assert.deepEqual(
    (await store.listAcceptedFiles(account, workspace)).map(
      (file) => file.deleted,
    ),
    [true],
  );

  const digest = await contentDigest('keep me\n');
  await store.applyRemoteChanges(
    account,
    workspace,
    [
      {
        file: {
          fileId,
          revisionId: 'restore-revision',
          path: 'notes/one.md',
          fileKind: 'note',
          deleted: false,
          digest,
          text: 'keep me\n',
        },
        purgedFileId: null,
      },
    ],
    '5',
  );

  // A tombstone carries no text, so the text of the deletion draft is not
  // unsent work and the restore of the server wins.
  const listed = await store.listLocalFiles(account, workspace);
  assert.deepEqual(
    listed.map((file) => ({ fileId: file.fileId, deleted: file.deleted })),
    [{ fileId, deleted: false }],
  );
  const cached = await store.readCachedNote(account, workspace, fileId);
  assert.equal(cached?.deleted, false);
  assert.equal(cached?.text, 'keep me\n');

  // The tombstone draft goes with the deletion it recorded. A draft that
  // stayed would shadow every later edit of the note it names.
  assert.equal(await store.readDraft(account, workspace, 'copy-a'), null);
  await store.close();
});

await test('snapshot activation and clearing publish committed invalidations', async () => {
  const backend = createBackend('committed-invalidations');
  const store = await openLocalStore(origin, backend.options());
  const otherStore = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const changes: string[] = [];
  const unsubscribe = otherStore.subscribe((change) => {
    changes.push(`${change.kind}:${change.fileId ?? 'all'}`);
  });
  const text = '# Snapshot\n';
  const digest = await contentDigest(text);
  await store.stageSnapshot(
    account,
    workspace,
    'snapshot-token',
    ['rev-1'],
    '7',
  );
  await store.storeSnapshotRevision(account, workspace, {
    token: 'snapshot-token',
    revisionId: 'rev-1',
    fileId: file,
    path: 'notes/snapshot.md',
    kind: 'note',
    deleted: false,
    digest,
    text,
  });
  await store.activateSnapshot('snapshot-token');
  assert.deepEqual(changes, [`file:${file}`, 'cursor:all']);
  changes.length = 0;
  await store.clearPrivateData(account, workspace);
  assert.deepEqual(changes, ['reset:all']);
  unsubscribe();
  await otherStore.close();
  await store.close();
});

await test('browser stores share a fallback bus without BroadcastChannel', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  const channelDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'BroadcastChannel',
  );
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    value: undefined,
  });
  try {
    const backend = createBackend('browser-fallback-bus');
    const store = await openLocalStore(origin, backend.options());
    const otherStore = await openLocalStore(origin, backend.options());
    await store.close();
    const writingStore = await openLocalStore(origin, backend.options());
    const account = randomUUID();
    const workspace = randomUUID();
    const file = randomUUID();
    const changes: string[] = [];
    const unsubscribe = otherStore.subscribe((change) => {
      changes.push(`${change.kind}:${change.fileId ?? 'all'}`);
    });
    await writingStore.saveDraft(
      draftOf(account, workspace, file, 'copy-a', 'fallback text\n'),
    );
    assert.deepEqual(changes, [`draft:${file}`]);
    unsubscribe();
    await writingStore.close();
    await otherStore.close();
  } finally {
    if (windowDescriptor === undefined)
      Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', windowDescriptor);
    if (channelDescriptor === undefined)
      Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    else
      Object.defineProperty(globalThis, 'BroadcastChannel', channelDescriptor);
  }
});

await test('a draft that matches a newer accepted head is dropped on open', async () => {
  const backend = createBackend('draft-matches-head');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  // This device saves once and keeps typing, so a draft exists over the
  // accepted head it created.
  const first = draftOf(account, workspace, file, 'copy-a', 'one\n');
  await store.saveDraft(first);
  const entry = await store.checkpoint(first, null);
  const firstRevision = entry?.input.revisions[0]?.id ?? '';
  await store.acknowledge(account, acceptanceOf(entry, account, '10'));
  const shared = '# Shared\n';
  await store.saveDraft({ ...first, text: shared, sequence: 2 });

  // Another device saves exactly that text, and the change feed brings it.
  const remoteRevision = randomUUID();
  await store.applyRemoteChanges(
    account,
    workspace,
    [
      {
        file: {
          fileId: file,
          revisionId: remoteRevision,
          path: 'notes/one.md',
          fileKind: 'note',
          deleted: false,
          digest: await contentDigest(shared),
          text: shared,
        },
        purgedFileId: null,
      },
    ],
    '11',
  );

  const cached = await store.readCachedNote(account, workspace, file);
  assert.equal(cached?.stale, false);
  assert.equal(cached?.text, shared);
  // The draft says nothing the accepted head does not say, so it is gone and
  // the head is what opened.
  assert.equal(cached?.workingCopyId, undefined);
  assert.equal(cached?.baseRevisionId, remoteRevision);
  assert.equal(await store.readDraft(account, workspace, 'copy-a'), null);
  assert.notEqual(remoteRevision, firstRevision);
  await store.close();
});

await test('a draft over an older accepted head opens as stale', async () => {
  const backend = createBackend('draft-stale');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  const first = draftOf(account, workspace, file, 'copy-a', 'one\n');
  await store.saveDraft(first);
  const entry = await store.checkpoint(first, null);
  const firstRevision = entry?.input.revisions[0]?.id ?? '';
  await store.acknowledge(account, acceptanceOf(entry, account, '10'));
  await store.saveDraft({ ...first, text: 'my own text\n', sequence: 2 });

  const remoteText = '# From the other device\n';
  const remoteRevision = randomUUID();
  await store.applyRemoteChanges(
    account,
    workspace,
    [
      {
        file: {
          fileId: file,
          revisionId: remoteRevision,
          path: 'notes/one.md',
          fileKind: 'note',
          deleted: false,
          digest: await contentDigest(remoteText),
          text: remoteText,
        },
        purgedFileId: null,
      },
    ],
    '11',
  );

  const cached = await store.readCachedNote(account, workspace, file);
  assert.equal(cached?.stale, true);
  // Both texts reach the caller, so the person chooses and nothing is lost.
  assert.equal(cached?.text, 'my own text\n');
  assert.equal(cached?.acceptedText, remoteText);
  assert.equal(cached?.acceptedRevisionId, remoteRevision);
  assert.equal(cached?.baseRevisionId, firstRevision);
  assert.equal(cached?.workingCopyId, 'copy-a');

  // Keeping the text moves only its base, so the next save reaches the
  // server head instead of naming the one it replaced.
  await store.rebaseDraft(account, workspace, 'copy-a');
  const kept = await store.readCachedNote(account, workspace, file);
  assert.equal(kept?.stale, false);
  assert.equal(kept?.text, 'my own text\n');
  assert.equal(kept?.baseRevisionId, remoteRevision);
  const next = await store.checkpoint(
    {
      ...first,
      text: 'my own text\n',
      sequence: 3,
      baseRevisionId: kept?.baseRevisionId ?? null,
    },
    null,
  );
  assert.deepEqual(next?.input.expectedHeads, { [file]: remoteRevision });
  assert.deepEqual(next?.input.revisions[0]?.parents, [remoteRevision]);
  await store.close();
});

await test('a remote change keeps a draft that differs from it', async () => {
  const backend = createBackend('remote-keeps-draft');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  const first = draftOf(account, workspace, file, 'copy-a', 'one\n');
  await store.saveDraft(first);
  const entry = await store.checkpoint(first, null);
  const firstRevision = entry?.input.revisions[0]?.id ?? '';
  await store.acknowledge(account, acceptanceOf(entry, account, '10'));
  // The draft is renamed as well as retyped, so its identity is at stake.
  await store.saveDraft({
    ...first,
    text: 'my own text\n',
    path: 'notes/renamed.md',
    sequence: 2,
  });

  const remoteRevision = randomUUID();
  await store.applyRemoteChanges(
    account,
    workspace,
    [
      {
        file: {
          fileId: file,
          revisionId: remoteRevision,
          path: 'notes/one.md',
          fileKind: 'note',
          deleted: false,
          digest: await contentDigest('# Other\n'),
          text: '# Other\n',
        },
        purgedFileId: null,
      },
    ],
    '11',
  );

  const accepted = (await store.listAcceptedFiles(account, workspace)).find(
    (row) => row.fileId === file,
  );
  // The accepted head follows the server. The local head does not move,
  // because a draft that differs from the arriving head is unsubmitted work.
  // Without the draft half of the dirty test the local head would be the
  // remote revision and the draft would keep shadowing it.
  assert.equal(accepted?.acceptedHeadRevisionId, remoteRevision);
  assert.equal(accepted?.localHeadRevisionId, firstRevision);
  const draft = await store.readDraft(account, workspace, 'copy-a');
  assert.equal(draft?.text, 'my own text\n');
  assert.equal(draft?.path, 'notes/renamed.md');
  // The rename is still the identity the note opens with, and the open is
  // stale, so the person is told before that rename becomes a version.
  const cached = await store.readCachedNote(account, workspace, file);
  assert.equal(cached?.path, 'notes/renamed.md');
  assert.equal(cached?.stale, true);
  assert.equal(cached?.acceptedPath, 'notes/one.md');
  await store.close();
});

await test('a checkpoint of an older buffer is refused', async () => {
  const backend = createBackend('stale-checkpoint');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  const older = draftOf(account, workspace, file, 'copy-a', 'first text\n');
  await store.saveDraft(older);
  await store.saveDraft({ ...older, text: 'newest text\n', sequence: 5 });

  await assert.rejects(
    () => store.checkpoint(older, null),
    (thrown: unknown) => {
      assert.ok(isLocalStorageError(thrown));
      assert.equal(thrown.kind, 'stale');
      return true;
    },
  );
  // Nothing was written, so the newest text is still the working copy.
  assert.deepEqual(await store.pending(account, workspace), []);
  assert.equal(
    (await store.listCheckpoints(account, workspace, file)).length,
    0,
  );
  assert.equal(
    (await store.readDraft(account, workspace, 'copy-a'))?.text,
    'newest text\n',
  );
  await store.close();
});

await test('a parked save keeps its text in the recovery area', async () => {
  const backend = createBackend('parked-save');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  const draft = draftOf(account, workspace, file, 'copy-a', 'refused text\n');
  await store.saveDraft(draft);
  const entry = await store.checkpoint(draft, null);
  assert.ok(entry !== null);

  // The server refused the save for good, so the queue parks it.
  await parkRefusedSave(store, account, entry, 'path_conflict');
  const parked = await store.listLocalConflicts(account, workspace);
  assert.equal(parked.length, 1);
  assert.equal(parked[0]?.errorCode, 'path_conflict');

  const kept = await store.recover(account, workspace);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.text, 'refused text\n');
  assert.equal(kept[0]?.path, 'notes/one.md');
  assert.equal(kept[0]?.reason, 'save_refused');
  assert.equal(kept[0]?.code, 'path_conflict');
  assert.equal(kept[0]?.mutationId, entry.input.mutationId);
  assert.equal(kept[0]?.fileId, file);

  // Discarding the parked entry leaves the queue empty and never sends it.
  await store.discardQueueEntry(account, entry.input.mutationId);
  assert.deepEqual(await store.pending(account, workspace), []);
  await store.close();
});

await test('an unknown refusal code still parks the text', async () => {
  const backend = createBackend('parked-unknown');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  const draft = draftOf(account, workspace, file, 'copy-a', 'kept text\n');
  await store.saveDraft(draft);
  const entry = await store.checkpoint(draft, null);
  assert.ok(entry !== null);
  await parkRefusedSave(store, account, entry, 'deleted_remotely');

  const kept = await store.recover(account, workspace);
  assert.equal(kept[0]?.code, 'deleted_remotely');
  assert.equal(kept[0]?.reason, 'save_refused');
  await store.close();
});

await test('a draft with no base is not reported as stale', async () => {
  const backend = createBackend('draft-no-base');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  // The note starts on this device, so its first draft names no base.
  const created = draftOf(account, workspace, file, 'copy-a', 'first\n');
  await store.saveDraft(created);
  const entry = await store.checkpoint(created, null);
  const revisionId = entry?.input.revisions[0]?.id ?? '';
  await store.acknowledge(account, acceptanceOf(entry, account, '10'));

  // A second working copy of the same file writes without a base, which is
  // what a caller does when its own draft row was already removed. An
  // unknown base is not evidence that the server moved on, so no stale
  // choice is offered and no false warning reaches the person. The accepted
  // row is then the newer statement of the file and it opens instead.
  await store.saveDraft(
    draftOf(account, workspace, file, 'copy-b', 'later text\n', {
      baseRevisionId: null,
      sequence: 1,
    }),
  );
  const cached = await store.readCachedNote(account, workspace, file);
  assert.equal(cached?.stale, false);
  assert.equal(cached?.acceptedText, null);
  assert.equal(cached?.text, 'first\n');
  assert.equal(cached?.acceptedRevisionId, revisionId);
  await store.close();
});

await test('a queued save of this device never reads as a stale draft', async () => {
  const backend = createBackend('own-head-not-stale');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  const first = draftOf(account, workspace, file, 'copy-a', 'one\n');
  await store.saveDraft(first);
  const accepted = await store.checkpoint(first, null);
  const acceptedRevision = accepted?.input.revisions[0]?.id ?? '';
  await store.acknowledge(account, acceptanceOf(accepted, account, '10'));

  // A second save waits for the server, so the accepted head is behind the
  // work of this device rather than ahead of it. That is not a stale draft.
  const second = { ...first, text: 'two\n', sequence: 2 };
  await store.saveDraft(second);
  const queued = await store.checkpoint(second, null);
  assert.ok(queued !== null);
  await store.saveDraft({ ...second, text: 'three\n', sequence: 3 });

  const cached = await store.readCachedNote(account, workspace, file);
  assert.equal(cached?.stale, false);
  assert.equal(cached?.acceptedText, null);
  assert.equal(cached?.text, 'three\n');
  assert.equal(cached?.acceptedRevisionId, acceptedRevision);
  await store.close();
});

await test('forgetting a purged file removes every local trace of it', async () => {
  const backend = createBackend('forget-purged');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  // The file exists on the device: an accepted head, a queued edit, and a
  // recovery copy parked for it. A purge must take all three.
  const draft = draftOf(account, workspace, file, 'copy-a', '# One\n');
  await store.saveDraft(draft);
  const created = await store.checkpoint(draft, null);
  await store.acknowledge(account, acceptanceOf(created, account, '1'));
  const edited = { ...draft, text: '# Two\n', sequence: 2 };
  await store.saveDraft(edited);
  const queued = await store.checkpoint(edited, null);
  assert.ok(queued !== null);
  await parkRefusedSave(store, account, queued, 'purged');

  const changes: LocalChange[] = [];
  const unsubscribe = store.subscribe((change) => changes.push(change));
  await store.forgetPurgedFiles(account, workspace, [file]);
  unsubscribe();

  assert.deepEqual(changes, [
    { accountId: account, workspaceId: workspace, fileId: file, kind: 'purge' },
  ]);
  assert.deepEqual(await store.listLocalFiles(account, workspace), []);
  assert.deepEqual(await store.listAcceptedFiles(account, workspace), []);
  assert.deepEqual(await store.pending(account, workspace), []);
  assert.deepEqual(await store.recover(account, workspace), []);
  assert.equal(await store.readDraft(account, workspace, 'copy-a'), null);
  await withRawDatabase(backend, async (tables) => {
    const checkpoints = await tables.checkpoints
      .where('[serverOrigin+accountId+workspaceId+fileId]')
      .equals([origin, account, workspace, file])
      .toArray();
    assert.deepEqual(checkpoints, []);
  });
  await store.close();
});

await test('a purge marker forgets the queue and recovery, not only the file row', async () => {
  const backend = createBackend('purge-marker-forget');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  const draft = draftOf(account, workspace, file, 'copy-a', 'purge me\n');
  await store.saveDraft(draft);
  const created = await store.checkpoint(draft, null);
  await store.acknowledge(account, acceptanceOf(created, account, '1'));
  // A queued edit and a parked recovery copy are still on the device when the
  // purge marker arrives. A re-send of the edit, or the recovery copy, would
  // bring the note back, so the marker must clear both.
  const edited = { ...draft, text: 'edit\n', sequence: 2 };
  await store.saveDraft(edited);
  const queued = await store.checkpoint(edited, null);
  assert.ok(queued !== null);
  await parkRefusedSave(store, account, queued, 'save_refused');

  const changes: LocalChange[] = [];
  const unsubscribe = store.subscribe((change) => changes.push(change));
  await store.applyRemoteChanges(
    account,
    workspace,
    [{ file: null, purgedFileId: file }],
    '2',
  );
  unsubscribe();

  assert.deepEqual(changes, [
    { accountId: account, workspaceId: workspace, fileId: file, kind: 'purge' },
  ]);
  assert.deepEqual(await store.listLocalFiles(account, workspace), []);
  assert.deepEqual(await store.pending(account, workspace), []);
  assert.deepEqual(await store.recover(account, workspace), []);
  await store.close();
});

await test('a fresh snapshot forgets a purged note but keeps unsent local work', async () => {
  const backend = createBackend('snapshot-forget');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const purged = randomUUID();
  const local = randomUUID();
  const kept = randomUUID();

  // One note is accepted and then purged on the server. One note is a local
  // draft this device has not sent. The snapshot below contains neither, plus
  // one note the server does hold.
  const purgedDraft = draftOf(account, workspace, purged, 'copy-p', 'gone\n');
  await store.saveDraft(purgedDraft);
  const acceptedPurged = await store.checkpoint(purgedDraft, null);
  await store.acknowledge(account, acceptanceOf(acceptedPurged, account, '1'));
  const localDraft = draftOf(account, workspace, local, 'copy-l', 'mine\n', {
    path: 'notes/mine.md',
  });
  await store.saveDraft(localDraft);
  const localEntry = await store.checkpoint(localDraft, null);
  assert.ok(localEntry !== null);

  const text = '# Kept\n';
  const digest = await contentDigest(text);
  await store.stageSnapshot(account, workspace, 'token', ['rev-kept'], '9');
  await store.storeSnapshotRevision(account, workspace, {
    token: 'token',
    revisionId: 'rev-kept',
    fileId: kept,
    path: 'notes/kept.md',
    kind: 'note',
    deleted: false,
    digest,
    text,
  });
  await store.activateSnapshot('token');

  const files = (await store.listLocalFiles(account, workspace)).map(
    (file) => file.fileId,
  );
  assert.ok(files.includes(kept), 'the snapshot note is present');
  assert.ok(files.includes(local), 'the unsent local note is kept');
  assert.ok(!files.includes(purged), 'the purged note is forgotten');
  const stillQueued = (await store.pending(account, workspace)).some((entry) =>
    entry.input.revisions.some((revision) => revision.fileId === local),
  );
  assert.ok(stillQueued, 'the unsent local mutation is kept');
  await store.close();
});

await test('acknowledging a tombstone removes the leftover deletion draft', async () => {
  const backend = createBackend('ack-tombstone-draft');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();

  const draft = draftOf(account, workspace, file, 'copy-a', '# Body\n');
  await store.saveDraft(draft);
  const created = await store.checkpoint(draft, null);
  await store.acknowledge(account, acceptanceOf(created, account, '1'));
  const removal = { ...draft, deleted: true, text: '', sequence: 2 };
  await store.saveDraft(removal);
  const removed = await store.checkpoint(removal, null);
  await store.acknowledge(account, acceptanceOf(removed, account, '2'));

  // The deletion draft is redundant once the server accepts the tombstone,
  // and a leftover would shadow a later restore of the same file.
  assert.equal(await store.readDraft(account, workspace, 'copy-a'), null);
  await withRawDatabase(backend, async (tables) => {
    const drafts = await tables.drafts
      .where('[serverOrigin+accountId+workspaceId+fileId]')
      .equals([origin, account, workspace, file])
      .toArray();
    assert.deepEqual(drafts, []);
  });
  assert.deepEqual(
    (await store.listLocalFiles(account, workspace)).map(
      (file) => file.deleted,
    ),
    [true],
  );
  await store.close();
});
