/**
 * The note use case.
 *
 * The store of this test answers every note of the workspace, so the scope
 * rule, and not the query, decides what a reader reads.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
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
import { readPublishedNote } from './read-note.ts';

const address = { tokenDigest: 'token-digest', ticketDigest: null };
const inScope = '10000000-0000-4000-8000-000000000001';
const outOfScope = '10000000-0000-4000-8000-000000000002';
const inTrash = '10000000-0000-4000-8000-000000000003';

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

const link: PublishedLink = {
  publicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scope: { kind: 'folder', path: 'notes/trip' },
  createdAt: '2026-09-16T07:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  passwordProtected: false,
};

/** A context whose store forgets the scope of the link. */
function contextOf(current: PublishedLink): PublicationContext & {
  readonly causes: ReaderRefusalCause[];
} {
  const causes: ReaderRefusalCause[] = [];
  const refusals: ReaderRefusalLog = {
    record(cause) {
      causes.push(cause);
    },
  };
  const reader: PublicationReader = {
    linkByTokenDigest: (tokenDigest) =>
      Promise.resolve(tokenDigest === 'token-digest' ? current : null),
    ticketOfLink: () => Promise.resolve(null),
    noteOfLink: (_link, fileId) =>
      Promise.resolve(notes.find((entry) => entry.fileId === fileId) ?? null),
    notesOfLink: (_link, limit) =>
      Promise.resolve<readonly PublishedNote[]>(notes.slice(0, limit)),
    attachmentsOfNote: () => Promise.resolve([]),
  };
  const store: PublicationStore = { read: (run) => run(reader) };
  return {
    store,
    clock: () => Date.parse('2026-09-16T08:00:00.000Z'),
    refusals,
    causes,
  };
}

await test('a note of the scope reads with its content', async () => {
  const context = contextOf(link);
  const result = await readPublishedNote(context, address, inScope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.note.path, 'notes/trip/day-1.md');
  assert.equal(result.value.note.text, '# notes/trip/day-1.md');
  assert.equal(result.value.link.publicationId, link.publicationId);
  assert.deepEqual(context.causes, []);
});

await test('a note outside the scope takes the one refusal', async () => {
  const context = contextOf(link);
  const result = await readPublishedNote(context, address, outOfScope);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, publishedLinkUnavailable);
  assert.deepEqual(context.causes, ['out_of_scope']);
});

await test('a note in the Trash takes the one refusal', async () => {
  const context = contextOf(link);
  const result = await readPublishedNote(context, address, inTrash);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, publishedLinkUnavailable);
  assert.deepEqual(context.causes, ['out_of_scope']);
});

await test('a note that no record holds takes the one refusal', async () => {
  const context = contextOf(link);
  const result = await readPublishedNote(
    context,
    address,
    '10000000-0000-4000-8000-000000000009',
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, publishedLinkUnavailable);
  assert.deepEqual(context.causes, ['out_of_scope']);
});

await test('a note link opens its note after a rename', async () => {
  const oneNote: PublishedLink = {
    ...link,
    scope: { kind: 'note', fileId: outOfScope },
  };
  const context = contextOf(oneNote);
  const result = await readPublishedNote(context, address, outOfScope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.note.fileId, outOfScope);
});
