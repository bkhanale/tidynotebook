/**
 * The parser of a stored published link.
 *
 * Every refusal below is a row that the domain cannot read. The parser throws
 * for each one, so no undeclared value reaches a use case, and a reader never
 * receives a link whose scope no query could hold.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationalError } from '@notesapp/core';
import {
  isSecretDigest,
  likeEscape,
  parsePublicationRow,
  storedScope,
  type PublicationLookupRow,
} from './publication-row.ts';

const digest = 'a'.repeat(64);
const created = new Date('2026-09-16T10:00:00.000Z');

/** One row of the lookup function, with the members of a folder link. */
function folderRow(over: PublicationLookupRow = {}): PublicationLookupRow {
  return {
    publication_id: '11111111-1111-4111-8111-111111111111',
    workspace_id: '22222222-2222-4222-8222-222222222222',
    owner_account_id: '33333333-3333-4333-8333-333333333333',
    scope_kind: 'folder',
    scope_file_id: null,
    scope_path: 'notes/trip',
    password_protected: false,
    created_at: created,
    expires_at: null,
    revoked_at: null,
    ...over,
  };
}

await test('a digest is 64 lower case hexadecimal characters', () => {
  assert.equal(isSecretDigest(digest), true);
  assert.equal(isSecretDigest(digest.toUpperCase()), false);
  assert.equal(isSecretDigest(digest.slice(1)), false);
  // A token of the shape that the product hands to a reader is not a digest.
  assert.equal(isSecretDigest('Zm9vYmFyYmF6cXV4'), false);
});

await test('a like bound escapes every wildcard of a stored path', () => {
  assert.equal(likeEscape('notes/trip/'), 'notes/trip/');
  assert.equal(likeEscape('notes/100% done/'), 'notes/100\\% done/');
  assert.equal(likeEscape('notes/a_b/'), 'notes/a\\_b/');
  assert.equal(likeEscape('notes/a\\b/'), 'notes/a\\\\b/');
});

await test('a folder row answers the folder prefix of the scope rule', () => {
  const stored = parsePublicationRow(folderRow());
  assert.deepEqual(stored.link.scope, { kind: 'folder', path: 'notes/trip' });
  assert.equal(stored.scopePrefix, 'notes/trip/');
  assert.equal(stored.scopeFileId, null);
  assert.equal(stored.link.createdAt, created.toISOString());
  assert.equal(stored.ownerAccountId, '33333333-3333-4333-8333-333333333333');
});

await test('a note row answers the file of the scope', () => {
  const stored = parsePublicationRow(
    folderRow({
      scope_kind: 'note',
      scope_file_id: '44444444-4444-4444-8444-444444444444',
      scope_path: null,
    }),
  );
  assert.deepEqual(stored.link.scope, {
    kind: 'note',
    fileId: '44444444-4444-4444-8444-444444444444',
  });
  assert.equal(stored.scopeFileId, '44444444-4444-4444-8444-444444444444');
  assert.equal(stored.scopePrefix, null);
});

await test('an expiry and a revocation travel as instants', () => {
  const stopped = new Date('2026-10-01T00:00:00.000Z');
  const stored = parsePublicationRow(
    folderRow({ expires_at: stopped, revoked_at: stopped }),
  );
  assert.equal(stored.link.expiresAt, stopped.toISOString());
  assert.equal(stored.link.revokedAt, stopped.toISOString());
});

await test('a row that states both scope members is refused', () => {
  assert.throws(
    () =>
      parsePublicationRow(
        folderRow({ scope_file_id: '44444444-4444-4444-8444-444444444444' }),
      ),
    OperationalError,
  );
});

await test('a row that states no scope member is refused', () => {
  assert.throws(
    () => parsePublicationRow(folderRow({ scope_path: null })),
    OperationalError,
  );
  assert.throws(
    () => storedScope('note', null, null),
    (error: unknown) => error instanceof OperationalError,
  );
});

await test('a folder path that the path rules refuse opens nothing', () => {
  // A path with an empty segment has no bound, so the row is refused rather
  // than answered as a link that a query could not hold inside its folder.
  assert.throws(
    () => parsePublicationRow(folderRow({ scope_path: 'notes//trip' })),
    OperationalError,
  );
});

await test('an unreadable column is refused', () => {
  for (const over of [
    { publication_id: 42 },
    { workspace_id: '' },
    { created_at: '2026-09-16T10:00:00.000Z' },
    { expires_at: 'soon' },
    { password_protected: 'yes' },
    { scope_kind: 'workspace' },
  ]) {
    assert.throws(() => parsePublicationRow(folderRow(over)), OperationalError);
  }
});
