/** Search relevance, permission, and local draft search checks. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import pg from 'pg';
import {
  commitChangeset,
  searchFiles,
  verifyActor,
  tombstoneContent,
  type RevisionInput,
} from '@notesapp/core';
import { openLocalStore } from '@notesapp/storage-browser';
import {
  createDocumentService,
  openWorkspaceStore,
  runMigrations,
} from '@notesapp/storage-server';
import { searchLocal } from '@notesapp/sync';
import {
  changeset,
  memberActor,
  revision,
  seedWorkspace,
  createDisposableDatabase,
  testIdentityPassword,
  testPassword,
} from './support/database.ts';

const database = await createDisposableDatabase();
const store = openWorkspaceStore(database.runtimeUrl, createDocumentService());
const accountId = randomUUID();
const workspaceId = randomUUID();
await seedWorkspace(database, workspaceId, [{ accountId, role: 'owner' }]);
const actor = memberActor(accountId, workspaceId);

/** Accepts one or more revisions and returns their last revision. */
async function accept(
  entries: readonly RevisionInput[],
  expectedHeads?: Readonly<Record<string, string | null>>,
): Promise<RevisionInput> {
  const input = changeset(workspaceId, entries, {
    ...(expectedHeads === undefined ? {} : { expectedHeads }),
  });
  const accepted = await commitChangeset(
    store,
    actor,
    input,
    `search-${input.mutationId}`,
  );
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const last = entries.at(-1);
  assert.ok(last !== undefined);
  return last;
}

await test('search includes accepted titles and content but not deleted notes', async () => {
  const fileId = randomUUID();
  const first = await accept([
    revision({
      fileId,
      path: 'plans/offline.md',
      text: '# Recovery\nThe durable queue keeps offline work safe.\n',
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'durable offline');
  assert.equal(found.ok, true);
  if (found.ok) {
    assert.deepEqual(
      found.value.map((hit) => hit.fileId),
      [fileId],
    );
    assert.equal(found.value[0]?.revisionId, first.id);
  }

  await accept(
    [
      revision({
        fileId,
        parents: [first.id],
        path: first.path,
        deleted: true,
        content: tombstoneContent(first.content, {
          work: { kind: 'none' },
          epoch: 1,
          observed: null,
        }),
      }),
    ],
    { [fileId]: first.id },
  );
  const afterDelete = await searchFiles(store, actor, workspaceId, 'durable');
  assert.equal(afterDelete.ok, true);
  if (afterDelete.ok) assert.deepEqual(afterDelete.value, []);
});

await test('each word matches as a prefix, so a short word form finds a longer one', async () => {
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'training/Sprints.md',
      text: '# Sprints\nThe team is running along the canal.\n',
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'run canal');
  assert.equal(found.ok, true);
  if (found.ok)
    assert.deepEqual(
      found.value.map((hit) => hit.fileId),
      [fileId],
    );
});

await test('the last word matches as a prefix, so search as you type works', async () => {
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'index/Notes.md',
      text: '# Notes\nOne list of everything.\n',
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'not');
  assert.equal(found.ok, true);
  if (found.ok)
    assert.ok(
      found.value.some((hit) => hit.fileId === fileId),
      'a note named Notes answers the prefix "not"',
    );
});

await test('a name match ranks above a note that matches in its text alone', async () => {
  const namedId = randomUUID();
  const bodyId = randomUUID();
  await accept([
    revision({
      fileId: bodyId,
      path: 'boats/Canoes.md',
      text: `# Canoes\n${'A kayak is not a canoe. '.repeat(20)}`,
    }),
    revision({
      fileId: namedId,
      path: 'boats/Kayak.md',
      text: '# Kayak\nOne boat for one person.\n',
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'kayak');
  assert.equal(found.ok, true);
  if (found.ok)
    assert.deepEqual(
      found.value.map((hit) => hit.fileId),
      [namedId, bodyId],
    );
});

await test('the excerpt is the matching part of the note, with the word marked', async () => {
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'gear/Jackets.md',
      text: `# Jackets\n${'Padding and lining. '.repeat(40)}Every jacket carries its own flotation.\n`,
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'flotation');
  assert.equal(found.ok, true);
  if (!found.ok) return;
  const hit = found.value.find((entry) => entry.fileId === fileId);
  assert.ok(hit !== undefined);
  assert.deepEqual(
    hit.excerpt.filter((part) => part.marked).map((part) => part.text),
    ['flotation'],
  );
  const whole = hit.excerpt.map((part) => part.text).join('');
  assert.match(whole, /carries its own flotation/);
  assert.ok(
    !whole.includes('# Jackets'),
    'the excerpt shows the match and not the head of the note',
  );
});

await test('the excerpt is the plain text of the note, with no Markdown', async () => {
  // Issue 253. The headline was cut from the Markdown of the note, so a
  // palette result showed `**` marks and whole link addresses.
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'trips/Canoe.md',
      text: '# Canoe\n\nThe **portage** route is in [the trip plan](https://maps.example.com/routes/portage-trail).\n',
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'portage');
  assert.equal(found.ok, true);
  if (!found.ok) return;
  const hit = found.value.find((entry) => entry.fileId === fileId);
  assert.ok(hit !== undefined);
  const whole = hit.excerpt.map((part) => part.text).join('');
  // The first heading repeats the name the result is shown under, so it goes,
  // and no block runs into the next.
  assert.equal(whole, 'The portage route is in the trip plan.');
  assert.doesNotMatch(whole, /\*\*|\]\(|https:|maps\.example|#/);
  assert.deepEqual(
    hit.excerpt.filter((part) => part.marked).map((part) => part.text),
    ['portage'],
await test('a note in another language matches by its own words', async () => {
  // Issue 246. The English configuration dropped `will` as a stop word, so
  // the German verb could never be found.
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'reisen/Plan.md',
      text: '# Plan\nEr will morgen nach Hause fahren.\n',
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'will');
  assert.equal(found.ok, true);
  if (found.ok)
    assert.deepEqual(
      found.value.map((hit) => hit.fileId),
      [fileId],
    );
});

await test('a letter with an accent matches the same letter without one', async () => {
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'reisen/Kaffee.md',
      text: '# Kaffee\nEin kleines Café in München.\n',
    }),
  ]);
  for (const query of ['cafe munchen', 'café münchen']) {
    const found = await searchFiles(store, actor, workspaceId, query);
    assert.equal(found.ok, true);
    if (!found.ok) return;
    const hit = found.value.find((entry) => entry.fileId === fileId);
    assert.ok(hit !== undefined, `the query "${query}" finds the note`);
    assert.deepEqual(
      hit.excerpt.filter((part) => part.marked).map((part) => part.text),
      ['Café', 'München'],
    );
  }
});

await test('the excerpt quotes the text that a reader sees', async () => {
  // Issue 253. The index held the raw Markdown, so an excerpt showed the
  // marks of emphasis and the address of a link.
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'gear/Paddles.md',
      text: '# Paddles\nA **carbon** paddle from [the shop](https://example.com/private/order) weighs little.\n',
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'carbon');
  assert.equal(found.ok, true);
  if (!found.ok) return;
  const hit = found.value.find((entry) => entry.fileId === fileId);
  assert.ok(hit !== undefined);
  const whole = hit.excerpt.map((part) => part.text).join('');
  assert.match(whole, /A carbon paddle from the shop weighs little/);
  assert.ok(!whole.includes('**'), 'the excerpt holds no mark of emphasis');
  assert.ok(!whole.includes('example.com'), 'the excerpt holds no address');
  const address = await searchFiles(store, actor, workspaceId, 'private order');
  assert.equal(address.ok, true);
  if (address.ok)
    assert.ok(
      !address.value.some((entry) => entry.fileId === fileId),
      'the address of a link is not a word of the note',
    );
});

await test('a match deep in a long note is the excerpt of that note', async () => {
  // Issue 265. The excerpt reads a window of the text around the first
  // match, so a long note costs no more than a short one, and the window
  // still holds the match.
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'long/Logbook.md',
      text: `# Logbook\n${'Calm water and a steady wind. '.repeat(8000)}The anchor chain broke at dawn.\n`,
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'anchor chain');
  assert.equal(found.ok, true);
  if (!found.ok) return;
  const hit = found.value.find((entry) => entry.fileId === fileId);
  assert.ok(hit !== undefined);
  assert.deepEqual(
    hit.excerpt.filter((part) => part.marked).map((part) => part.text),
    ['anchor', 'chain'],
  );
});

await test('the blocks of an excerpt stay apart', async () => {
  // Review of issue 253: a heading and the paragraph under it read as one
  // sentence, "Plan The budget is in the sheet."
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'trips/Kettle.md',
      text: '# Packing\n\nThe **stove** goes in the bag\n\n- fuel\n- lighter\n',
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'stove');
  assert.equal(found.ok, true);
  if (!found.ok) return;
  const hit = found.value.find((entry) => entry.fileId === fileId);
  assert.ok(hit !== undefined);
  assert.equal(
    hit.excerpt.map((part) => part.text).join(''),
    'Packing · The stove goes in the bag · fuel · lighter',
  );
});

await test('a search of more notes than the limit answers the best ranked page', async () => {
  // Issue 207. The page is ranked and cut before its excerpts, so the cut
  // keeps the name match and the notes that hold the word most often.
  const namedId = randomUUID();
  const oftenId = randomUUID();
  const entries = [
    revision({
      fileId: namedId,
      path: 'rivers/Rapids.md',
      text: '# Rapids\nOne note.\n',
    }),
    revision({
      fileId: oftenId,
      path: 'rivers/Often.md',
      text: `# Often\n${'rapids '.repeat(30)}\n`,
    }),
    ...Array.from({ length: 6 }, (_, index) =>
      revision({
        fileId: randomUUID(),
        path: `rivers/Once ${String(index)}.md`,
        text: `# Once ${String(index)}\n${'Calm water. '.repeat(20)} rapids.\n`,
      }),
    ),
  ];
  await accept(entries);
  const found = await searchFiles(store, actor, workspaceId, 'rapids', 2);
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.deepEqual(
    found.value.map((hit) => hit.fileId),
    [namedId, oftenId],
  );
  for (const hit of found.value)
    assert.ok(hit.excerpt.some((part) => part.marked));
});

await test('the search reads the stored vector of a note', async () => {
  // Issue 207. A vector built from the text of each match at query time
  // cost most of the search, so the index stores it and the function reads
  // it. The definition names no text search parse of a row.
  const client = new pg.Client({ connectionString: database.migrationUrl });
  await client.connect();
  try {
    const definition = await client.query<{ source: string }>(
      "select pg_get_functiondef('public.notesapp_search(uuid, text, integer)'::regprocedure) as source",
    );
    const source = definition.rows[0]?.source ?? '';
    assert.match(source, /indexed\.document @@ needle/);
    assert.doesNotMatch(source, /to_tsvector/);
    const column = await client.query<{ generated: string }>(
      `select is_generated as generated from information_schema.columns
        where table_schema = 'public' and table_name = 'search_index'
          and column_name = 'document'`,
    );
    assert.equal(column.rows[0]?.generated, 'ALWAYS');
  } finally {
    await client.end();
  }
});

await test('the excerpt reads a window of the text and never the whole body', async () => {
  // Issue 265. A headline over the whole body of a long note cost most of a
  // search for a common word, so the function hands the headline a window.
  const client = new pg.Client({ connectionString: database.migrationUrl });
  await client.connect();
  try {
    const definition = await client.query<{ source: string }>(
      "select pg_get_functiondef('public.notesapp_search(uuid, text, integer)'::regprocedure) as source",
    );
    const source = definition.rows[0]?.source ?? '';
    assert.match(source, /translate\(windowed\.source,/);
    assert.doesNotMatch(source, /translate\(page\.body,/);
    assert.match(source, /'public\.notesapp_text'/);
    assert.doesNotMatch(source, /'english'/);
  } finally {
    await client.end();
  }
});

await test('the migration makes a row of an earlier rule again', async () => {
  // Record 0167. A row that release 0.12 wrote holds the raw Markdown and
  // rule 0. The data migration writes the readable text, and search then
  // reads it.
  const fileId = randomUUID();
  const markdown =
    '# Canals\nThe **lock** keeper waves at [boats](https://example.com/boats).\n';
  await accept([revision({ fileId, path: 'water/Canals.md', text: markdown })]);
  const client = new pg.Client({ connectionString: database.migrationUrl });
  await client.connect();
  try {
    await client.query(
      'update search_index set body = $3, text_rule = 0 where workspace_id = $1 and file_id = $2',
      [workspaceId, fileId, markdown],
    );
    await runMigrations({
      documents: createDocumentService(),
      databaseUrl: database.migrationUrl,
      runtimePassword: testPassword(),
      authPassword: testIdentityPassword(),
    });
    const row = await client.query<{ body: string; text_rule: number }>(
      'select body, text_rule from search_index where workspace_id = $1 and file_id = $2',
      [workspaceId, fileId],
    );
    assert.deepEqual(row.rows, [
      {
        body: 'Canals\nThe lock keeper waves at boats.',
        text_rule: 1,
      },
    ]);
  } finally {
    await client.end();
  }
  const found = await searchFiles(store, actor, workspaceId, 'lock keeper');
  assert.equal(found.ok, true);
  if (!found.ok) return;
  const hit = found.value.find((entry) => entry.fileId === fileId);
  assert.ok(hit !== undefined);
  assert.ok(!hit.excerpt.some((part) => part.text.includes('**')));
});

await test('search requires the current role and a read grant', async () => {
  const created = verifyActor(accountId, [{ workspaceId, actions: ['write'] }]);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const denied = await searchFiles(
    store,
    created.value,
    workspaceId,
    'Duplicate',
  );
  assert.deepEqual(denied, {
    ok: false,
    error: { code: 'forbidden', fileIds: [] },
  });
});

await test('the indexed search function checks transaction membership directly', async () => {
  await accept([
    revision({
      fileId: randomUUID(),
      path: 'a/Duplicate.md',
      text: '# Duplicate\nOne duplicate note for the membership check.\n',
    }),
  ]);
  const client = new pg.Client({ connectionString: database.runtimeUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('notesapp.account_id', $1, true)", [
      accountId,
    ]);
    const member = await client.query<{ file_id: string }>(
      'select file_id from public.notesapp_search($1, $2, $3)',
      [workspaceId, 'Duplicate', 10],
    );
    assert.ok(member.rows.length > 0);
    await client.query('rollback');

    await client.query('begin');
    await client.query("select set_config('notesapp.account_id', $1, true)", [
      randomUUID(),
    ]);
    const stranger = await client.query<{ file_id: string }>(
      'select file_id from public.notesapp_search($1, $2, $3)',
      [workspaceId, 'Duplicate', 10],
    );
    assert.deepEqual(stranger.rows, []);
    await client.query('rollback');
  } finally {
    await client.end();
  }
});

await test('local draft search stays inside its account and workspace', async () => {
  const local = await openLocalStore('https://local-search.test', {
    indexedDB: new IDBFactory(),
    IDBKeyRange,
    databaseName: `notesapp-search-${randomUUID()}`,
    deviceId: 'search-device',
  });
  const otherAccount = randomUUID();
  await local.saveDraft({
    accountId,
    workspaceId,
    workingCopyId: randomUUID(),
    fileId: randomUUID(),
    baseRevisionId: null,
    text: 'pending draft needle',
    path: 'draft.md',
    deleted: false,
    sequence: 1,
  });
  await local.saveDraft({
    accountId: otherAccount,
    workspaceId,
    workingCopyId: randomUUID(),
    fileId: randomUUID(),
    baseRevisionId: null,
    text: 'private needle',
    path: 'private.md',
    deleted: false,
    sequence: 1,
  });
  const documents = await local.listSearchFiles(accountId, workspaceId);
  assert.deepEqual(
    searchLocal('needle', documents).map((hit) => hit.path),
    ['draft.md'],
  );
  await local.close();
});

await store.close();
await database.destroy();
