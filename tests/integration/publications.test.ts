/**
 * Published read-only links against real PostgreSQL.
 *
 * This file proves the storage half of plan 007: the two tables, their row
 * access, the read-only unit of work, and the one query that bounds the scope.
 * Each check runs through the product path, and the checks of a database
 * guarantee run direct statements beside it, as `row-access.test.ts` does.
 *
 * The security property of decision 0030 is the first test: no working token
 * and no working ticket is at rest. A person who reads both tables holds
 * digests, and a digest opens nothing, because the server digests what a
 * reader sends and compares the two.
 *
 * Start the service first:
 *
 * ```sh
 * sudo -n docker compose -f compose.test.yaml up -d --wait
 * ```
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  listPublishedNotes,
  maxPublishedLinksPerWorkspace,
  readPublishedNote,
  resolvePublishedAttachment,
  resolvePublishedLink,
  type Actor,
  type PublicationContext,
  type PublishedLink,
  type ReaderRefusalCause,
  type Result,
} from '@notesapp/core';
import {
  openWorkspaceStore,
  readOnlyTransactionCode,
  type PublishedLinkDraft,
  type WorkspaceStoreHandle,
} from '@notesapp/storage-server';
import {
  changeset,
  createDisposableDatabase,
  memberActor,
  openSession,
  revision,
  seedWorkspace,
  type TestDatabase,
  type TestSession,
} from './support/database.ts';

const database: TestDatabase = await createDisposableDatabase();
const store: WorkspaceStoreHandle = openWorkspaceStore(database.runtimeUrl, {
  poolSize: 4,
});
/** The schema owner reads every row, so it states what is at rest. */
const admin: TestSession = await openSession(database.migrationUrl);

/** The digest rule of the reader path: a fast one way hash of a full secret. */
function digestOf(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** One opaque token, in the shape that the owner copies. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** One reader context over the store, with the causes it recorded. */
function readerContext(now: () => number = Date.now): {
  readonly context: PublicationContext;
  readonly causes: ReaderRefusalCause[];
} {
  const causes: ReaderRefusalCause[] = [];
  return {
    context: {
      store: store.publications,
      clock: now,
      refusals: { record: (cause) => causes.push(cause) },
    },
    causes,
  };
}

/** The value of a successful result, or a failed assertion. */
function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, 'the call refused');
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

/** Writes one changeset and fails the test when the workspace refused it. */
async function write(
  actor: Actor,
  workspaceId: string,
  entries: Parameters<typeof changeset>[1],
  expectedHeads?: Readonly<Record<string, string | null>>,
): Promise<void> {
  const input =
    expectedHeads === undefined
      ? changeset(workspaceId, entries)
      : changeset(workspaceId, entries, { expectedHeads });
  const result = await store.transact(actor, workspaceId, (tx) =>
    tx.accept(actor, input, randomUUID()),
  );
  assert.equal(result.ok, true, 'the seed changeset was refused');
}

/** One published link, with the token that the owner copied once. */
type SeededLink = {
  readonly link: PublishedLink;
  readonly token: string;
};

/** Publishes one link through the owner path. */
async function publish(
  actor: Actor,
  workspaceId: string,
  draft: Omit<PublishedLinkDraft, 'tokenDigest'>,
): Promise<SeededLink> {
  const token = newToken();
  const created = await store.publishedLinks.create(actor, workspaceId, {
    ...draft,
    tokenDigest: digestOf(token),
  });
  return { link: value(created), token };
}

/** The seeded world of this file. */
const ownerAccountId = randomUUID();
const strangerAccountId = randomUUID();
const workspaceId = randomUUID();
const secondWorkspaceId = randomUUID();
const strangerWorkspaceId = randomUUID();
const bulkWorkspaceId = randomUUID();

await seedWorkspace(database, workspaceId, [
  { accountId: ownerAccountId, role: 'owner' },
]);
await seedWorkspace(database, secondWorkspaceId, [
  { accountId: ownerAccountId, role: 'owner' },
]);
await seedWorkspace(database, bulkWorkspaceId, [
  { accountId: ownerAccountId, role: 'owner' },
]);
await seedWorkspace(database, strangerWorkspaceId, [
  { accountId: strangerAccountId, role: 'owner' },
]);

const owner = memberActor(ownerAccountId, workspaceId);
const secondOwner = memberActor(ownerAccountId, secondWorkspaceId);
const bulkOwner = memberActor(ownerAccountId, bulkWorkspaceId);
const stranger = memberActor(strangerAccountId, strangerWorkspaceId);

const attachmentObjectId = randomUUID();
await admin.query(
  `insert into attachment_objects (workspace_id, id, digest, size, media_type, state)
   values ($1, $2, 'sha256-published-photo', 24, 'image/png', 'finalized')`,
  [workspaceId, attachmentObjectId],
);

const photo = revision({
  fileId: randomUUID(),
  path: 'attachments/photo.png',
  content: {
    kind: 'attachment',
    digest: 'sha256-published-photo',
    objectId: attachmentObjectId,
  },
});
const dayOne = revision({
  fileId: randomUUID(),
  path: 'notes/trip/day-1.md',
  text: '# Day 1\n\n![photo](../../attachments/photo.png)\n',
});
const dayTwo = revision({
  fileId: randomUUID(),
  path: 'notes/trip/nested/day-2.md',
  text: '# Day 2\n',
});
const sibling = revision({
  fileId: randomUUID(),
  path: 'notes/trips-2026/other.md',
  text: '# Another trip\n',
});
const secret = revision({
  fileId: randomUUID(),
  path: 'notes/private.md',
  text: '# Private\n\n![photo](../attachments/photo.png)\n',
});
const dropped = revision({
  fileId: randomUUID(),
  path: 'notes/trip/gone.md',
  text: '# Gone\n',
});
await write(owner, workspaceId, [
  photo,
  dayOne,
  dayTwo,
  sibling,
  secret,
  dropped,
]);
await write(
  owner,
  workspaceId,
  [
    revision({
      fileId: dropped.fileId,
      parents: [dropped.id],
      path: dropped.path,
      deleted: true,
      text: '',
    }),
  ],
  { [dropped.fileId]: dropped.id },
);

/** The second workspace of the same owner holds the same folder and path. */
const twin = revision({
  fileId: randomUUID(),
  path: 'notes/trip/day-1.md',
  text: '# The twin of another workspace\n',
});
await write(secondOwner, secondWorkspaceId, [twin]);

const folder = await publish(owner, workspaceId, {
  scope: { kind: 'folder', path: 'notes/trip' },
  passwordDigest: null,
  expiresAt: null,
});
const single = await publish(owner, workspaceId, {
  scope: { kind: 'note', fileId: secret.fileId },
  passwordDigest: null,
  expiresAt: null,
});

await test('no working token and no working ticket is at rest', async () => {
  const rows = await admin.query<{
    token_digest: string;
    password_digest: string | null;
    scope_path: string | null;
  }>(
    'select token_digest, password_digest, scope_path from publications where workspace_id = $1',
    [workspaceId],
  );
  assert.equal(rows.length, 2);
  const stored = rows.map((row) => row.token_digest).sort();
  assert.deepEqual(
    stored,
    [digestOf(folder.token), digestOf(single.token)].sort(),
  );
  for (const row of rows) {
    assert.equal(row.token_digest.includes(folder.token), false);
    assert.equal(row.token_digest.includes(single.token), false);
    assert.equal(row.password_digest, null);
  }

  // The stored value is not a token. A person who reads the row and sends the
  // digest as a token gives the server the digest of the digest, which names
  // no link at all.
  const reader = readerContext();
  const replayed = await resolvePublishedLink(reader.context, {
    tokenDigest: digestOf(digestOf(folder.token)),
    ticketDigest: null,
  });
  assert.equal(replayed.ok, false);
  assert.deepEqual(reader.causes, ['unknown']);

  // The one token that does open the link opens it, so the check above
  // refuses a replay and not every request.
  const opened = readerContext();
  const link = value(
    await resolvePublishedLink(opened.context, {
      tokenDigest: digestOf(folder.token),
      ticketDigest: null,
    }),
  );
  assert.equal(link.publicationId, folder.link.publicationId);
});

await test('the database refuses a raw secret in a digest column', async () => {
  const refusedToken = await admin.failure(
    `insert into publications
        (workspace_id, id, owner_account_id, token_digest, scope_kind, scope_path)
      values ($1, $2, $3, $4, 'folder', 'notes/trip')`,
    [workspaceId, randomUUID(), ownerAccountId, newToken()],
  );
  assert.equal(refusedToken.code, '23514');

  const refusedTicket = await admin.failure(
    `insert into reading_tickets
        (ticket_digest, workspace_id, publication_id, expires_at)
      values ($1, $2, $3, now() + interval '1 hour')`,
    [newToken(), workspaceId, folder.link.publicationId],
  );
  assert.equal(refusedTicket.code, '23514');
});

await test('a reading ticket opens its own link only', async () => {
  const ticket = newToken();
  const other = newToken();
  await admin.query(
    `insert into reading_tickets
        (ticket_digest, workspace_id, publication_id, expires_at)
      values ($1, $2, $3, now() + interval '12 hours'),
             ($4, $2, $5, now() + interval '12 hours')`,
    [
      digestOf(ticket),
      workspaceId,
      folder.link.publicationId,
      digestOf(other),
      single.link.publicationId,
    ],
  );
  const found = await store.publications.read(async (reader) => {
    const link = await reader.linkByTokenDigest(digestOf(folder.token));
    assert.notEqual(link, null);
    if (link === null) throw new Error('unreachable');
    return {
      own: await reader.ticketOfLink(link, digestOf(ticket)),
      foreign: await reader.ticketOfLink(link, digestOf(other)),
      unknown: await reader.ticketOfLink(link, digestOf(newToken())),
    };
  });
  assert.equal(found.own?.publicationId, folder.link.publicationId);
  assert.equal(found.foreign, null);
  assert.equal(found.unknown, null);
  await admin.query('delete from reading_tickets where workspace_id = $1', [
    workspaceId,
  ]);
});

await test('one account cannot read the links of another', async () => {
  const mine = await openSession(database.runtimeUrl, ownerAccountId);
  const theirs = await openSession(database.runtimeUrl, strangerAccountId);
  const anonymous = await openSession(database.runtimeUrl);
  try {
    const own = await mine.query<{ id: string }>('select id from publications');
    assert.equal(own.length, 2);
    const foreign = await theirs.query<{ id: string }>(
      'select id from publications',
    );
    assert.deepEqual(foreign, []);
    // A transaction that sets no identity matches no policy at all.
    const nobody = await anonymous.query<{ id: string }>(
      'select id from publications',
    );
    assert.deepEqual(nobody, []);
    const tickets = await theirs.query<{ ticket_digest: string }>(
      'select ticket_digest from reading_tickets',
    );
    assert.deepEqual(tickets, []);
  } finally {
    await mine.close();
    await theirs.close();
    await anonymous.close();
  }

  // The owner list of the stranger holds the links of the stranger only.
  assert.deepEqual(
    await store.publishedLinks.list(stranger, strangerWorkspaceId),
    [],
  );
  const listed = await store.publishedLinks.list(owner, workspaceId);
  assert.deepEqual(
    listed.map((link) => link.publicationId).sort(),
    [folder.link.publicationId, single.link.publicationId].sort(),
  );
});

await test('the runtime role cannot change a link beside its revocation', async () => {
  const session = await openSession(database.runtimeUrl, ownerAccountId);
  try {
    const refused = await session.failure(
      'update publications set token_digest = $1 where id = $2',
      [digestOf(newToken()), folder.link.publicationId],
    );
    assert.equal(refused.code, '42501');
    const refusedDelete = await session.failure(
      'delete from publications where id = $1',
      [folder.link.publicationId],
    );
    assert.equal(refusedDelete.code, '42501');
    // A read never moves a ticket, because the role cannot write one.
    const refusedTicket = await session.failure(
      'update reading_tickets set expires_at = now()',
    );
    assert.equal(refusedTicket.code, '42501');
  } finally {
    await session.close();
  }
});

await test('PostgreSQL refuses a write inside the publication transaction', async () => {
  assert.equal(await store.probePublicationWrite(), readOnlyTransactionCode);
  // The refused write left nothing behind.
  const rows = await admin.query<{ ticket_digest: string }>(
    'select ticket_digest from reading_tickets',
  );
  assert.deepEqual(rows, []);
});

await test('a folder link lists every note below it and nothing else', async () => {
  const reader = readerContext();
  const listed = value(
    await listPublishedNotes(reader.context, {
      tokenDigest: digestOf(folder.token),
      ticketDigest: null,
    }),
  );
  assert.deepEqual(
    listed.notes.map((note) => note.path),
    ['notes/trip/day-1.md', 'notes/trip/nested/day-2.md'],
  );
  assert.deepEqual(reader.causes, []);
});

await test('a note link lists its one note', async () => {
  const reader = readerContext();
  const listed = value(
    await listPublishedNotes(reader.context, {
      tokenDigest: digestOf(single.token),
      ticketDigest: null,
    }),
  );
  assert.deepEqual(
    listed.notes.map((note) => note.path),
    ['notes/private.md'],
  );
});

await test('a note outside the scope is not readable by its identifier', async () => {
  const outside = [
    { name: 'a note beside the folder', fileId: secret.fileId },
    { name: 'a sibling folder with the same prefix', fileId: sibling.fileId },
    { name: 'a note in the Trash', fileId: dropped.fileId },
    { name: 'the same path of another workspace', fileId: twin.fileId },
    { name: 'an identifier that names nothing', fileId: randomUUID() },
    { name: 'a value that is not an identifier', fileId: 'notes/private.md' },
  ];
  for (const { name, fileId } of outside) {
    const reader = readerContext();
    const answer = await readPublishedNote(
      reader.context,
      { tokenDigest: digestOf(folder.token), ticketDigest: null },
      fileId,
    );
    assert.equal(answer.ok, false, name);
    assert.deepEqual(reader.causes, ['out_of_scope'], name);
  }

  const inside = readerContext();
  const read = value(
    await readPublishedNote(
      inside.context,
      { tokenDigest: digestOf(folder.token), ticketDigest: null },
      dayOne.fileId,
    ),
  );
  assert.equal(read.note.path, 'notes/trip/day-1.md');
  assert.match(read.note.text, /# Day 1/);
});

await test('the lookup of a token digest reads one row through the index', async () => {
  // A plan is only evidence when the table is large enough for the planner to
  // have a choice, so this check fills a second workspace first.
  await admin.query(
    `insert into publications
        (workspace_id, id, owner_account_id, token_digest, scope_kind, scope_path)
      select $1, gen_random_uuid(), $2,
        encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'folder', 'notes/bulk'
      from generate_series(1, 500)`,
    [bulkWorkspaceId, ownerAccountId],
  );
  await admin.query('analyze publications');
  const plan = await admin.query<{ 'QUERY PLAN': string }>(
    'explain (analyze) select id from publications where token_digest = $1',
    [digestOf(folder.token)],
  );
  const text = plan.map((row) => row['QUERY PLAN']).join('\n');
  assert.match(text, /Index Scan using publications_token_key/);
  assert.match(text, /rows=1/);
  await admin.query('delete from publications where workspace_id = $1', [
    bulkWorkspaceId,
  ]);
});

await test('a workspace holds at most 200 links', async () => {
  const fill = maxPublishedLinksPerWorkspace - 1;
  await admin.query(
    `insert into publications
        (workspace_id, id, owner_account_id, token_digest, scope_kind, scope_path)
      select $1, gen_random_uuid(), $2,
        encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'folder', 'notes/bulk'
      from generate_series(1, $3::integer)`,
    [bulkWorkspaceId, ownerAccountId, fill],
  );
  const last = await publish(bulkOwner, bulkWorkspaceId, {
    scope: { kind: 'folder', path: 'notes/bulk' },
    passwordDigest: null,
    expiresAt: null,
  });
  assert.equal(last.link.scope.kind, 'folder');
  const refused = await store.publishedLinks.create(
    bulkOwner,
    bulkWorkspaceId,
    {
      tokenDigest: digestOf(newToken()),
      scope: { kind: 'folder', path: 'notes/bulk' },
      passwordDigest: null,
      expiresAt: null,
    },
  );
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, 'quota');
  await admin.query('delete from publications where workspace_id = $1', [
    bulkWorkspaceId,
  ]);
});

await test('a link over a note that the workspace does not hold is refused', async () => {
  const refused = await store.publishedLinks.create(owner, workspaceId, {
    tokenDigest: digestOf(newToken()),
    scope: { kind: 'note', fileId: twin.fileId },
    passwordDigest: null,
    expiresAt: null,
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, 'not_found');

  // A note in the Trash is not a note that a link can open either.
  const trashed = await store.publishedLinks.create(owner, workspaceId, {
    tokenDigest: digestOf(newToken()),
    scope: { kind: 'note', fileId: dropped.fileId },
    passwordDigest: null,
    expiresAt: null,
  });
  assert.equal(trashed.ok, false);
});

await test('an attachment travels only while the current head names it', async () => {
  const reader = readerContext();
  const allowed = value(
    await resolvePublishedAttachment(
      reader.context,
      { tokenDigest: digestOf(folder.token), ticketDigest: null },
      { fileId: dayOne.fileId, revisionId: photo.id },
    ),
  );
  assert.equal(allowed.revisionId, photo.id);

  // The same picture is named by a note outside the scope as well, and that
  // note opens nothing.
  const outside = readerContext();
  const refused = await resolvePublishedAttachment(
    outside.context,
    { tokenDigest: digestOf(folder.token), ticketDigest: null },
    { fileId: secret.fileId, revisionId: photo.id },
  );
  assert.equal(refused.ok, false);
  assert.deepEqual(outside.causes, ['out_of_scope']);

  // The author drops the picture from the note, and the address stops working.
  await write(
    owner,
    workspaceId,
    [
      revision({
        fileId: dayOne.fileId,
        parents: [dayOne.id],
        path: dayOne.path,
        text: '# Day 1\n\nNo picture now.\n',
      }),
    ],
    { [dayOne.fileId]: dayOne.id },
  );
  const after = readerContext();
  const gone = await resolvePublishedAttachment(
    after.context,
    { tokenDigest: digestOf(folder.token), ticketDigest: null },
    { fileId: dayOne.fileId, revisionId: photo.id },
  );
  assert.equal(gone.ok, false);
  assert.deepEqual(after.causes, ['no_reference']);
});

await test('a revoked link and an expired link answer the one refusal', async () => {
  const stopped = await publish(owner, workspaceId, {
    scope: { kind: 'folder', path: 'notes/trip' },
    passwordDigest: null,
    expiresAt: new Date('2026-09-15T00:00:00.000Z').toISOString(),
  });
  const expired = readerContext(() => Date.parse('2026-09-16T00:00:00.000Z'));
  const refusedExpiry = await resolvePublishedLink(expired.context, {
    tokenDigest: digestOf(stopped.token),
    ticketDigest: null,
  });
  assert.equal(refusedExpiry.ok, false);
  assert.deepEqual(expired.causes, ['expired']);

  const live = await publish(owner, workspaceId, {
    scope: { kind: 'folder', path: 'notes/trip' },
    passwordDigest: null,
    expiresAt: null,
  });
  const revoked = value(
    await store.publishedLinks.revoke(
      owner,
      workspaceId,
      live.link.publicationId,
      new Date('2026-09-16T09:00:00.000Z'),
    ),
  );
  assert.equal(revoked.revokedAt, '2026-09-16T09:00:00.000Z');
  const reader = readerContext();
  const refusedRevoked = await resolvePublishedLink(reader.context, {
    tokenDigest: digestOf(live.token),
    ticketDigest: null,
  });
  assert.equal(refusedRevoked.ok, false);
  assert.deepEqual(reader.causes, ['revoked']);

  // A second revocation keeps the first instant and answers the same link.
  const again = value(
    await store.publishedLinks.revoke(
      owner,
      workspaceId,
      live.link.publicationId,
      new Date('2026-09-17T09:00:00.000Z'),
    ),
  );
  assert.equal(again.revokedAt, '2026-09-16T09:00:00.000Z');

  const unknown = await store.publishedLinks.revoke(
    owner,
    workspaceId,
    randomUUID(),
    new Date(),
  );
  assert.equal(unknown.ok, false);
});

await test('a revoked link leaves the list of the owner and frees its place', async () => {
  // Regression. The list is the audit surface of the feature, so it answers
  // what is open right now (decision 0048). A revoked link opens nothing from
  // the instant of the revocation, and the row that the retention run has not
  // reached yet used to come back on the next read of the screen, with the
  // words of a live link. The count of the limit reads the same set, so the
  // refusal that tells an owner to revoke a link and publish again is true at
  // the next request instead of at the next hour.
  const link = await publish(owner, workspaceId, {
    scope: { kind: 'folder', path: 'notes/trip' },
    passwordDigest: null,
    expiresAt: null,
  });
  const before = await store.publishedLinks.list(owner, workspaceId);
  assert.ok(
    before.some((entry) => entry.publicationId === link.link.publicationId),
  );
  value(
    await store.publishedLinks.revoke(
      owner,
      workspaceId,
      link.link.publicationId,
      new Date(),
    ),
  );
  const after = await store.publishedLinks.list(owner, workspaceId);
  assert.ok(
    !after.some((entry) => entry.publicationId === link.link.publicationId),
  );
  assert.equal(after.length, before.length - 1);
  // The row is still at rest until the retention run, and it is the row of a
  // link that opens nothing.
  const rows = await admin.query<{ count: string }>(
    'select count(*)::text as count from publications where id = $1 and revoked_at is not null',
    [link.link.publicationId],
  );
  assert.equal(rows[0]?.count, '1');
});

await test('the cleanup takes the dead record and keeps the live one', async () => {
  const before = await admin.query<{ count: string }>(
    'select count(*)::text as count from publications where workspace_id = $1',
    [workspaceId],
  );
  const ticket = newToken();
  await admin.query(
    `insert into reading_tickets
        (ticket_digest, workspace_id, publication_id, expires_at)
      values ($1, $2, $3, '2026-01-01T00:00:00.000Z')`,
    [digestOf(ticket), workspaceId, folder.link.publicationId],
  );
  const removed = await store.cleanupPublications(
    new Date('2026-09-18T00:00:00.000Z'),
  );
  // The expired link and the two revoked links of the checks above, and the
  // ticket. A revoked row is dead to every reader and to the owner list, and
  // this run is what finally takes it away.
  assert.equal(removed.expiredLinks, 3);
  assert.equal(removed.expiredTickets, 1);
  const after = await admin.query<{ count: string }>(
    'select count(*)::text as count from publications where workspace_id = $1',
    [workspaceId],
  );
  assert.equal(Number(after[0]?.count), Number(before[0]?.count) - 3);

  const reader = readerContext();
  const link = value(
    await resolvePublishedLink(reader.context, {
      tokenDigest: digestOf(folder.token),
      ticketDigest: null,
    }),
  );
  assert.equal(link.publicationId, folder.link.publicationId);
});

await test('a workspace deletion takes its links with it', async () => {
  const deleted = randomUUID();
  const accountId = randomUUID();
  await seedWorkspace(database, deleted, [{ accountId, role: 'owner' }]);
  // An account keeps its last workspace (record 0051), so this account holds a
  // second one and the deletion below is a legal call.
  await seedWorkspace(database, randomUUID(), [{ accountId, role: 'owner' }]);
  const actor = memberActor(accountId, deleted);
  const link = await publish(actor, deleted, {
    scope: { kind: 'folder', path: 'notes/trip' },
    passwordDigest: null,
    expiresAt: null,
  });
  const session = await openSession(database.runtimeUrl, accountId);
  try {
    await session.query('select public.notesapp_delete_workspace($1)', [
      deleted,
    ]);
  } finally {
    await session.close();
  }
  const rows = await admin.query<{ id: string }>(
    'select id from publications where id = $1',
    [link.link.publicationId],
  );
  assert.deepEqual(rows, []);
});

await admin.close();
await store.close();
await database.destroy();
