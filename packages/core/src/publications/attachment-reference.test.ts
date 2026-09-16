/**
 * The attachment reference rule.
 *
 * The store of these tests answers every note and every reference that a
 * caller names, whatever the scope of the link states, so the rule refuses
 * without help from the query.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePublishedAttachment } from './attachment-reference.ts';
import {
  publishedLinkUnavailable,
  type ReaderRefusalCause,
  type ReaderRefusalLog,
} from './errors.ts';
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

const address = { tokenDigest: 'token-digest', ticketDigest: null };
const inScope = '10000000-0000-4000-8000-000000000001';
const outOfScope = '10000000-0000-4000-8000-000000000002';
const inTrash = '10000000-0000-4000-8000-000000000003';
const picture = '20000000-0000-4000-8000-000000000001';
const secretPicture = '20000000-0000-4000-8000-000000000002';
const dropped = '20000000-0000-4000-8000-000000000003';

/** One note of the workspace. */
function note(
  fileId: string,
  path: string,
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

const notes: readonly PublishedNoteContent[] = [
  note(inScope, 'notes/trip/day-1.md'),
  note(outOfScope, 'notes/salary/2026.md'),
  note(inTrash, 'notes/trip/gone.md', true),
];

/** What the current head of each note names. */
const named = new Map<string, readonly string[]>([
  [inScope, [picture]],
  [outOfScope, [secretPicture]],
  [inTrash, [picture]],
]);

const link: PublishedLink = {
  publicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scope: { kind: 'folder', path: 'notes/trip' },
  createdAt: '2026-09-16T07:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  passwordProtected: false,
};

/** A store that forgets the scope in both of its reads. */
function carelessStore(): PublicationStore {
  const reader: PublicationReader = {
    linkByTokenDigest: (tokenDigest) =>
      Promise.resolve(tokenDigest === 'token-digest' ? link : null),
    ticketOfLink: () => Promise.resolve(null),
    noteOfLink: (_link, fileId) =>
      Promise.resolve(notes.find((entry) => entry.fileId === fileId) ?? null),
    notesOfLink: (_link, limit) =>
      Promise.resolve<readonly PublishedNote[]>(notes.slice(0, limit)),
    attachmentsOfNote: (_link, entry) =>
      Promise.resolve(named.get(entry.fileId) ?? []),
  };
  return { read: (run) => run(reader) };
}

/** A context over the careless store. */
function contextOf(): PublicationContext & {
  readonly causes: ReaderRefusalCause[];
} {
  const causes: ReaderRefusalCause[] = [];
  const refusals: ReaderRefusalLog = {
    record(cause) {
      causes.push(cause);
    },
  };
  return {
    store: carelessStore(),
    clock: () => Date.parse('2026-09-16T08:00:00.000Z'),
    refusals,
    causes,
  };
}

await test('a picture that the note names now travels', async () => {
  const context = contextOf();
  const result = await resolvePublishedAttachment(context, address, {
    fileId: inScope,
    revisionId: picture,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.revisionId, picture);
  assert.equal(result.value.note.fileId, inScope);
  assert.deepEqual(context.causes, []);
});

await test('a picture that only a note outside the scope names is refused', async () => {
  const context = contextOf();
  // The address names the note that holds the picture. The note is not in the
  // scope of the link, so the picture does not travel.
  const byItsOwner = await resolvePublishedAttachment(context, address, {
    fileId: outOfScope,
    revisionId: secretPicture,
  });
  assert.equal(byItsOwner.ok, false);
  if (byItsOwner.ok) return;
  assert.equal(byItsOwner.error, publishedLinkUnavailable);
  // The address names a note in the scope and the picture of the other note.
  const throughAnInScopeNote = await resolvePublishedAttachment(
    context,
    address,
    { fileId: inScope, revisionId: secretPicture },
  );
  assert.equal(throughAnInScopeNote.ok, false);
  if (throughAnInScopeNote.ok) return;
  assert.equal(throughAnInScopeNote.error, publishedLinkUnavailable);
  assert.deepEqual(context.causes, ['out_of_scope', 'no_reference']);
});

await test('a picture of a note in the Trash is refused', async () => {
  const context = contextOf();
  const result = await resolvePublishedAttachment(context, address, {
    fileId: inTrash,
    revisionId: picture,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, publishedLinkUnavailable);
  assert.deepEqual(context.causes, ['out_of_scope']);
});

await test('a picture that the current head no longer names is refused', async () => {
  const context = contextOf();
  const result = await resolvePublishedAttachment(context, address, {
    fileId: inScope,
    revisionId: dropped,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, publishedLinkUnavailable);
  assert.deepEqual(context.causes, ['no_reference']);
});
