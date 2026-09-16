/**
 * The listing rule.
 *
 * The store of this test answers every note of the workspace, so the list
 * proves that the rule, and not the query, bounds the answer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishedLinkUnavailable,
  type ReaderRefusalCause,
  type ReaderRefusalLog,
} from './errors.ts';
import { listPublishedNotes } from './list-scope.ts';
import type {
  PublishedLink,
  PublishedNote,
  PublishedNoteContent,
} from './model.ts';
import type {
  PublicationContext,
  PublicationReader,
  PublicationStore,
} from './ports.ts';

const publicationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const address = { tokenDigest: 'token-digest', ticketDigest: null };

/** One note of the workspace, with its content. */
function note(
  path: string,
  fileId: string,
  deleted = false,
): PublishedNoteContent {
  return {
    fileId,
    path,
    deleted,
    headRevisionId: `${fileId}-head`,
    updatedAt: '2026-09-16T07:30:00.000Z',
    text: `# ${path}`,
  };
}

/** Every note of the workspace, in and out of the scope. */
const workspaceNotes: readonly PublishedNoteContent[] = [
  note('notes/trip/food/thai.md', '10000000-0000-4000-8000-000000000001'),
  note('notes/trip/day-1.md', '10000000-0000-4000-8000-000000000002'),
  note('notes/trip.md', '10000000-0000-4000-8000-000000000003'),
  note('notes/trips-2026/day-1.md', '10000000-0000-4000-8000-000000000004'),
  note('notes/trip/gone.md', '10000000-0000-4000-8000-000000000005', true),
  note('notes/trip/photo.png', '10000000-0000-4000-8000-000000000006'),
  note('salary.md', '10000000-0000-4000-8000-000000000007'),
];

/** One folder link over `notes/trip`. */
const link: PublishedLink = {
  publicationId,
  workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scope: { kind: 'folder', path: 'notes/trip' },
  createdAt: '2026-09-16T07:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  passwordProtected: false,
};

/** A store that forgets the scope and answers every note it holds. */
function carelessStore(current: PublishedLink | null): PublicationStore {
  const reader: PublicationReader = {
    linkByTokenDigest: (tokenDigest) =>
      Promise.resolve(tokenDigest === 'token-digest' ? current : null),
    ticketOfLink: () => Promise.resolve(null),
    noteOfLink: (_link, fileId) =>
      Promise.resolve(workspaceNotes.find((n) => n.fileId === fileId) ?? null),
    notesOfLink: (_link, limit) =>
      Promise.resolve<readonly PublishedNote[]>(workspaceNotes.slice(0, limit)),
    attachmentsOfNote: () => Promise.resolve([]),
  };
  return { read: (run) => run(reader) };
}

/** A context over one link. */
function contextOf(current: PublishedLink | null): PublicationContext & {
  readonly causes: ReaderRefusalCause[];
} {
  const causes: ReaderRefusalCause[] = [];
  const refusals: ReaderRefusalLog = {
    record(cause) {
      causes.push(cause);
    },
  };
  return {
    store: carelessStore(current),
    clock: () => Date.parse('2026-09-16T08:00:00.000Z'),
    refusals,
    causes,
  };
}

await test('a folder link lists every note below it and nothing else', async () => {
  const result = await listPublishedNotes(contextOf(link), address);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.notes.map((entry) => entry.path),
    ['notes/trip/day-1.md', 'notes/trip/food/thai.md'],
  );
  // The list carries the identifier and the head of each note.
  assert.deepEqual(
    result.value.notes.map((entry) => entry.headRevisionId),
    [
      '10000000-0000-4000-8000-000000000002-head',
      '10000000-0000-4000-8000-000000000001-head',
    ],
  );
  assert.equal(result.value.link.publicationId, publicationId);
});

await test('a note link lists its one note', async () => {
  const oneNote: PublishedLink = {
    ...link,
    scope: { kind: 'note', fileId: '10000000-0000-4000-8000-000000000003' },
  };
  const result = await listPublishedNotes(contextOf(oneNote), address);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.notes.map((entry) => entry.path),
    ['notes/trip.md'],
  );
});

await test('a folder with no live note lists nothing', async () => {
  const empty: PublishedLink = {
    ...link,
    scope: { kind: 'folder', path: 'notes/trip/gone' },
  };
  const result = await listPublishedNotes(contextOf(empty), address);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.notes, []);
});

await test('a link that opens nothing lists nothing and refuses', async () => {
  const context = contextOf(null);
  const result = await listPublishedNotes(context, address);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, publishedLinkUnavailable);
  assert.deepEqual(context.causes, ['unknown']);
});
