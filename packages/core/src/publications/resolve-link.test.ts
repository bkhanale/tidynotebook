/**
 * The resolve use case.
 *
 * The store of these tests is careless on purpose: it answers every record
 * that a caller names, whatever the scope of the link states. The rules have
 * to refuse without help from the query.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Result } from '../files/model.ts';
import {
  publishedLinkUnavailable,
  type ReaderRefusalCause,
  type ReaderRefusalLog,
} from './errors.ts';
import type {
  PublishedAttachmentReference,
  PublishedLink,
  PublishedNote,
  PublishedNoteContent,
  ReadingTicket,
} from './model.ts';
import type {
  PublicationContext,
  PublicationReader,
  PublicationStore,
} from './ports.ts';
import { resolvePublishedLink } from './resolve-link.ts';
import { readingTicketExpiry } from './ticket.ts';

const hour = 60 * 60 * 1000;
const opened = Date.parse('2026-09-16T08:00:00.000Z');

/** What the in-memory store holds. */
type State = {
  link: PublishedLink | null;
  ticket: ReadingTicket | null;
  notes: PublishedNoteContent[];
  attachments: Map<string, readonly PublishedAttachmentReference[]>;
};

/** One link that opens one folder and asks for no password. */
function linkOf(over: Partial<PublishedLink> = {}): PublishedLink {
  return {
    publicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    scope: { kind: 'folder', path: 'notes/trip' },
    createdAt: '2026-09-16T07:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    passwordProtected: false,
    ...over,
  };
}

/** A store that answers from the state and writes nothing. */
function storeOf(state: State): PublicationStore {
  const reader: PublicationReader = {
    linkByTokenDigest: (tokenDigest) =>
      Promise.resolve(tokenDigest === 'token-digest' ? state.link : null),
    ticketOfLink: (_link, ticketDigest) =>
      Promise.resolve(ticketDigest === 'ticket-digest' ? state.ticket : null),
    noteOfLink: (_link, fileId) =>
      Promise.resolve(state.notes.find((n) => n.fileId === fileId) ?? null),
    notesOfLink: (_link, limit) =>
      Promise.resolve<readonly PublishedNote[]>(state.notes.slice(0, limit)),
    attachmentsOfNote: (_link, note) =>
      Promise.resolve(state.attachments.get(note.fileId) ?? []),
  };
  return { read: (run) => run(reader) };
}

/** A log that keeps the causes it received. */
function collector(): ReaderRefusalLog & {
  readonly causes: ReaderRefusalCause[];
} {
  const causes: ReaderRefusalCause[] = [];
  return {
    causes,
    record(cause) {
      causes.push(cause);
    },
  };
}

/** A context over one state, with a clock that the test moves. */
function contextOf(
  state: State,
  now: { ms: number },
): PublicationContext & { readonly log: ReturnType<typeof collector> } {
  const log = collector();
  return { store: storeOf(state), clock: () => now.ms, refusals: log, log };
}

/** The refusal of a result, which every test compares by identity. */
function refusalOf<T>(result: Result<T>): unknown {
  assert.equal(result.ok, false);
  return result.ok ? null : result.error;
}

const address = { tokenDigest: 'token-digest', ticketDigest: null };

await test('a link with no password opens', async () => {
  const state: State = {
    link: linkOf(),
    ticket: null,
    notes: [],
    attachments: new Map(),
  };
  const now = { ms: opened };
  const context = contextOf(state, now);
  const result = await resolvePublishedLink(context, address);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.publicationId, state.link?.publicationId);
  assert.deepEqual(context.log.causes, []);
});

await test('a link that never existed, a revoked link and an expired link refuse alike', async () => {
  const now = { ms: opened };
  const unknown = contextOf(
    { link: null, ticket: null, notes: [], attachments: new Map() },
    now,
  );
  const revoked = contextOf(
    {
      link: linkOf({ revokedAt: '2026-09-16T07:30:00.000Z' }),
      ticket: null,
      notes: [],
      attachments: new Map(),
    },
    now,
  );
  const expired = contextOf(
    {
      link: linkOf({ expiresAt: '2026-09-16T07:59:00.000Z' }),
      ticket: null,
      notes: [],
      attachments: new Map(),
    },
    now,
  );
  const locked = contextOf(
    {
      link: linkOf({ passwordProtected: true }),
      ticket: null,
      notes: [],
      attachments: new Map(),
    },
    now,
  );
  const results = await Promise.all([
    resolvePublishedLink(unknown, address),
    resolvePublishedLink(revoked, address),
    resolvePublishedLink(expired, address),
    resolvePublishedLink(locked, address),
  ]);
  const refusals = results.map((result) => refusalOf(result));
  // The four causes give one value, not four values that read alike.
  for (const refusal of refusals) {
    assert.equal(refusal, publishedLinkUnavailable);
    assert.deepEqual(refusal, refusals[0]);
  }
  // The cause reaches the operator and reaches no caller.
  assert.deepEqual(unknown.log.causes, ['unknown']);
  assert.deepEqual(revoked.log.causes, ['revoked']);
  assert.deepEqual(expired.log.causes, ['expired']);
  assert.deepEqual(locked.log.causes, ['locked']);
});

await test('a link stops at its expiry and an unreadable expiry stops it too', async () => {
  const now = { ms: opened };
  const state: State = {
    link: linkOf({ expiresAt: '2026-09-16T09:00:00.000Z' }),
    ticket: null,
    notes: [],
    attachments: new Map(),
  };
  const context = contextOf(state, now);
  assert.equal((await resolvePublishedLink(context, address)).ok, true);
  now.ms = Date.parse('2026-09-16T09:00:00.000Z');
  // The instant of the expiry is the first instant that refuses.
  assert.equal(
    refusalOf(await resolvePublishedLink(context, address)),
    publishedLinkUnavailable,
  );
  const broken = contextOf(
    {
      link: linkOf({ expiresAt: 'the day after' }),
      ticket: null,
      notes: [],
      attachments: new Map(),
    },
    { ms: opened },
  );
  assert.equal(
    refusalOf(await resolvePublishedLink(broken, address)),
    publishedLinkUnavailable,
  );
  assert.deepEqual(broken.log.causes, ['expired']);
});

await test('a revoked link refuses before its expiry is read', async () => {
  const context = contextOf(
    {
      link: linkOf({
        revokedAt: '2026-09-16T07:30:00.000Z',
        expiresAt: '2036-09-16T07:30:00.000Z',
      }),
      ticket: null,
      notes: [],
      attachments: new Map(),
    },
    { ms: opened },
  );
  assert.equal(
    refusalOf(await resolvePublishedLink(context, address)),
    publishedLinkUnavailable,
  );
  assert.deepEqual(context.log.causes, ['revoked']);
});

await test('a ticket of 12 hours works at hour 11 and stops at hour 13', async () => {
  const issuedAt = '2026-09-16T08:00:00.000Z';
  const expiresAt = readingTicketExpiry(issuedAt);
  assert.equal(expiresAt, '2026-09-16T20:00:00.000Z');
  if (expiresAt === null) return;
  const ticket: ReadingTicket = {
    publicationId: linkOf().publicationId,
    issuedAt,
    expiresAt,
  };
  const state: State = {
    link: linkOf({ passwordProtected: true }),
    ticket,
    notes: [],
    attachments: new Map(),
  };
  const now = { ms: opened };
  const context = contextOf(state, now);
  const unlocked = {
    tokenDigest: 'token-digest',
    ticketDigest: 'ticket-digest',
  };

  now.ms = opened + 11 * hour;
  assert.equal((await resolvePublishedLink(context, unlocked)).ok, true);
  now.ms = opened + 13 * hour;
  assert.equal(
    refusalOf(await resolvePublishedLink(context, unlocked)),
    publishedLinkUnavailable,
  );
  // A read does not move the expiry. The record is the record of the unlock.
  assert.deepEqual(state.ticket, {
    publicationId: ticket.publicationId,
    issuedAt,
    expiresAt,
  });
  assert.deepEqual(context.log.causes, ['locked']);
});

await test('a ticket of another link opens nothing', async () => {
  const issuedAt = '2026-09-16T08:00:00.000Z';
  const expiresAt = readingTicketExpiry(issuedAt) ?? issuedAt;
  const state: State = {
    link: linkOf({ passwordProtected: true }),
    ticket: {
      publicationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      issuedAt,
      expiresAt,
    },
    notes: [],
    attachments: new Map(),
  };
  const context = contextOf(state, { ms: opened + hour });
  assert.equal(
    refusalOf(
      await resolvePublishedLink(context, {
        tokenDigest: 'token-digest',
        ticketDigest: 'ticket-digest',
      }),
    ),
    publishedLinkUnavailable,
  );
  assert.deepEqual(context.log.causes, ['locked']);
});

await test('a wrong token reads no record of the workspace', async () => {
  const state: State = {
    link: linkOf(),
    ticket: null,
    notes: [],
    attachments: new Map(),
  };
  const context = contextOf(state, { ms: opened });
  assert.equal(
    refusalOf(
      await resolvePublishedLink(context, {
        tokenDigest: 'another-digest',
        ticketDigest: null,
      }),
    ),
    publishedLinkUnavailable,
  );
  assert.deepEqual(context.log.causes, ['unknown']);
});
