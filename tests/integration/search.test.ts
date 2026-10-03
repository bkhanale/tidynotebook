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
  storeTextOfAnEarlierRelease,
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
  // A headline ends at a word, so the full stop of the sentence stays out.
  assert.equal(whole, 'The portage route is in the trip plan');
  assert.doesNotMatch(whole, /\*\*|\]\(|https:|maps\.example|#/);
  assert.deepEqual(
    hit.excerpt.filter((part) => part.marked).map((part) => part.text),
    ['portage'],
  );
});

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

await test('the address of a link is not a word of the note', async () => {
  // Record 0167. The index holds the readable text, so search matches what
  // a reader sees and never the address behind a label.
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'gear/Paddles.md',
      text: '# Paddles\nA **carbon** paddle from [the shop](https://example.com/private/order) weighs little.\n',
    }),
  ]);
  const address = await searchFiles(store, actor, workspaceId, 'private order');
  assert.equal(address.ok, true);
  if (address.ok)
    assert.ok(!address.value.some((entry) => entry.fileId === fileId));
  const label = await searchFiles(store, actor, workspaceId, 'shop');
  assert.equal(label.ok, true);
  if (label.ok) assert.ok(label.value.some((entry) => entry.fileId === fileId));
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
  // The note that holds the word marks it in its excerpt. The note that
  // matched by its name alone shows the text under its name, because the
  // heading that repeats the name is no part of the excerpt (record 0162).
  const [named, often] = found.value;
  assert.deepEqual(named?.excerpt, [{ text: 'One note.', marked: false }]);
  assert.ok(
    often?.excerpt.some((part) => part.marked && part.text === 'rapids'),
  );
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

/** The marked words of the excerpt of one note for one query. */
async function markedWords(fileId: string, query: string): Promise<string[]> {
  const found = await searchFiles(store, actor, workspaceId, query);
  assert.equal(found.ok, true);
  if (!found.ok) return [];
  const hit = found.value.find((entry) => entry.fileId === fileId);
  assert.ok(hit !== undefined, `the query "${query}" finds the note`);
  return hit.excerpt.filter((part) => part.marked).map((part) => part.text);
}

/** Text of more than one excerpt window, before the words of a test. */
const longLead = 'We start early and walk on. '.repeat(60);

await test('the words of a query read as the index reads them', async () => {
  // Review of record 0167. The query split its text on letters and digits
  // with lower(), so a host, a number and a version never matched, and a
  // database of the C locale split a word of another script.
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'web/Hosts.md',
      text: '# Hosts\nOpen example.com for pi 3.14 on Über release v1.2.3.\n',
    }),
  ]);
  assert.deepEqual(await markedWords(fileId, 'example.com'), ['example.com']);
  assert.deepEqual(await markedWords(fileId, '3.14'), ['3.14']);
  assert.deepEqual(await markedWords(fileId, 'über'), ['Über']);
  assert.deepEqual(await markedWords(fileId, 'v1.2.3'), ['v1.2.3']);
});

await test('a word shorter than three letters matches only itself', async () => {
  // Review of record 0167. One letter matched as a prefix, so it read most of
  // the index.
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'zoo/Antelope.md',
      text: '# Grazers\nThe antelope runs.\n',
    }),
  ]);
  const short = await searchFiles(store, actor, workspaceId, 'an');
  assert.equal(short.ok, true);
  if (short.ok) assert.ok(!short.value.some((hit) => hit.fileId === fileId));
  assert.deepEqual(await markedWords(fileId, 'ant'), ['antelope']);
});

await test('the excerpt of a long note stands at the start of a matched word', async () => {
  // Review of issue 265. The window stood at the first substring, so "art"
  // stood at "start" and the excerpt showed no match.
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'long/Gallery.md',
      text: `# Gallery\n${longLead}The art show opens.\n`,
    }),
  ]);
  assert.deepEqual(await markedWords(fileId, 'art'), ['art']);
});

await test('the excerpt of a long note finds a word in another case', async () => {
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'long/Travel.md',
      text: `# Travel\n${longLead}Then we reach PARIS at night.\n`,
    }),
  ]);
  assert.deepEqual(await markedWords(fileId, 'paris'), ['PARIS']);
});

await test('the excerpt of a long note holds its match after letters that unaccent expands', async () => {
  // Review of issue 265. The place of a word came from a folded copy of the
  // body, and unaccent writes one letter of it as two, so the window drifted
  // past the match.
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'long/Islands.md',
      text: `# Islands\n${'Ærø æble. '.repeat(160)}The ANCHOR holds.\n`,
    }),
  ]);
  assert.deepEqual(await markedWords(fileId, 'anchor'), ['ANCHOR']);
});

await test('the migration writes the row of a live note that has none', async () => {
  // Review of record 0167. The record says that the data migration writes
  // the row of every live note that has none, and the code only rewrote the
  // rows that were there.
  const fileId = randomUUID();
  await accept([
    revision({
      fileId,
      path: 'water/Locks.md',
      text: '# Locks\nThe gate keeper opens the lock.\n',
    }),
  ]);
  const client = new pg.Client({ connectionString: database.migrationUrl });
  await client.connect();
  try {
    await client.query(
      'delete from search_index where workspace_id = $1 and file_id = $2',
      [workspaceId, fileId],
    );
    await runMigrations({
      documents: createDocumentService(),
      databaseUrl: database.migrationUrl,
      runtimePassword: testPassword(),
      authPassword: testIdentityPassword(),
    });
  } finally {
    await client.end();
  }
  assert.deepEqual(await markedWords(fileId, 'gate keeper'), [
    'gate',
    'keeper',
  ]);
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
        // The first heading repeats the name of the note, so it goes.
        body: 'The lock keeper waves at boats.',
        text_rule: 3,
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

await test('the migration drops the row of a note that the grammar refuses and goes on', async () => {
  // Review of the audit of 2026-10-02. The text of search read the HTML of a
  // note with no bound, so a stored note of 5000 nested elements threw a
  // RangeError. The migration runs before the server serves, so that one
  // note stopped the server from starting. The grammar now refuses the note
  // as the renderer does, and the run drops its row and reads the next note.
  const [deepId, laterId] = [randomUUID(), randomUUID()].toSorted();
  assert.ok(deepId !== undefined && laterId !== undefined);
  const deep = await accept([
    revision({
      fileId: deepId,
      path: 'old/Deep.md',
      text: '# Deep\nA note of an earlier release.\n',
    }),
  ]);
  await accept([
    revision({
      fileId: laterId,
      path: 'old/Later.md',
      text: '# Later\nThe harbour master counts barges.\n',
    }),
  ]);
  await storeTextOfAnEarlierRelease(
    database,
    workspaceId,
    deep.id,
    `${'<div>'.repeat(5000)}x\n`,
  );
  const client = new pg.Client({ connectionString: database.migrationUrl });
  await client.connect();
  try {
    // Both rows hold an earlier rule, so the run reads both notes, the
    // refused one first.
    await client.query(
      'update search_index set text_rule = 0 where workspace_id = $1 and file_id = any($2::uuid[])',
      [workspaceId, [deepId, laterId]],
    );
    await runMigrations({
      documents: createDocumentService(),
      databaseUrl: database.migrationUrl,
      runtimePassword: testPassword(),
      authPassword: testIdentityPassword(),
    });
    const rows = await client.query<{ file_id: string; body: string }>(
      'select file_id, body from search_index where workspace_id = $1 and file_id = any($2::uuid[])',
      [workspaceId, [deepId, laterId]],
    );
    assert.deepEqual(rows.rows, [
      { file_id: laterId, body: 'The harbour master counts barges.' },
    ]);
  } finally {
    await client.end();
  }
  // Search reads the row that the run wrote after the refused note.
  assert.deepEqual(await markedWords(laterId, 'harbour'), ['harbour']);
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
