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
  type Draft,
  type LocalStore,
  type QueueEntry,
} from '@notesapp/sync';
import {
  createDatabase,
  metaKey,
  openLocalStore,
  partitionRange,
  type BranchRow,
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
  failure: () => { store: string; method: string; error: Error } | null,
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
          return () => {
            throw chosen.error;
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
    baseRevisionId: null,
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
    baseRevisionId: revisionId,
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
    baseRevisionId: null,
  });
  await store.close();
});

await test('two working copies of one file produce a local branch', async () => {
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
  // Both name the accepted head as their parent. Neither is a child of the
  // other, so nothing was silently merged.
  assert.deepEqual(fromA?.input.revisions[0]?.parents, [firstRevision]);
  assert.deepEqual(fromB?.input.revisions[0]?.parents, [firstRevision]);

  const branches = await withRawDatabase(backend, async (tables) => {
    const range = partitionRange(origin, account, workspace);
    const rows: BranchRow[] = await tables.branches
      .where('[serverOrigin+accountId+workspaceId+fileId]')
      .between(range.lower, range.upper, true, true)
      .toArray();
    return rows;
  });
  assert.equal(branches.length, 1);
  assert.equal(branches[0]?.fileId, file);
  assert.equal(branches[0]?.baseRevisionId, firstRevision);
  assert.deepEqual(branches[0]?.tips, [revisionA, revisionB]);
  assert.equal(branches[0]?.resolved, false);

  const file2 = await withRawDatabase(backend, (tables) =>
    tables.acceptedFiles.get([origin, account, workspace, file]),
  );
  // The second tip did not advance the local head.
  assert.equal(file2?.localHeadRevisionId, revisionA);
  assert.equal(file2?.acceptedHeadRevisionId, firstRevision);
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
  console.log(
    `draft save over ${String(saveSamples.length)} runs: p50 ${at(saveSamples, 0.5).toFixed(2)} ms, ` +
      `p95 ${at(saveSamples, 0.95).toFixed(2)} ms, max ${(saveSamples.at(-1) ?? 0).toFixed(2)} ms ` +
      `(fake-indexeddb in Node, not browser durability)`,
  );
  console.log(
    `cached note open over ${String(readSamples.length)} runs: p50 ${at(readSamples, 0.5).toFixed(2)} ms, ` +
      `p95 ${at(readSamples, 0.95).toFixed(2)} ms, max ${(readSamples.at(-1) ?? 0).toFixed(2)} ms ` +
      `(fake-indexeddb in Node, not a browser paint)`,
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

await test('server conflict resolution clears its local queue atomically', async () => {
  const backend = createBackend('resolved-conflict');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  const draft = draftOf(account, workspace, file, 'copy-a', 'branch text\n');
  await store.saveDraft(draft);
  const entry = await store.checkpoint(draft, null);
  assert.ok(entry !== null);
  const groupId = randomUUID();
  await store.markConflict(account, entry.input.mutationId, {
    conflictGroupId: groupId,
    branchMutationId: randomUUID(),
    branchState: 'submitted',
    errorCode: null,
  });
  const accepted = acceptanceOf(entry, account, '8');
  const mergedId = randomUUID();
  await store.resolveConflict(account, workspace, groupId, {
    mutationId: randomUUID(),
    revisions: accepted.revisions.map((revision) => ({
      ...revision,
      revisionId: mergedId,
      parents: [revision.revisionId, randomUUID()],
    })),
  });
  assert.deepEqual(await store.pending(account, workspace), []);
  assert.deepEqual(await store.listLocalConflicts(account, workspace), []);
  const state = await store.readFileSaveSnapshot(account, workspace, file);
  assert.equal(state.acceptedHeadRevisionId, mergedId);
  assert.equal(state.localHeadRevisionId, mergedId);
  await store.close();
});
