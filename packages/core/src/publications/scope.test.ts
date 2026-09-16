/**
 * The scope rule.
 *
 * The two refusals that a plain prefix test would miss are the first two
 * tests: a folder whose name is the start of the name of a second folder, and
 * a note in the Trash.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicationScope, ScopedNote } from './model.ts';
import { folderScopePrefix, isNoteInScope, normalizeScope } from './scope.ts';

const trip = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const folder: PublicationScope = { kind: 'folder', path: 'notes/trip' };
const oneNote: PublicationScope = { kind: 'note', fileId: trip };

/** One live note of the workspace. */
function note(path: string, fileId = trip, deleted = false): ScopedNote {
  return { fileId, path, deleted };
}

await test('a folder with the same name start is out of scope', () => {
  assert.equal(isNoteInScope(folder, note('notes/trip/day-1.md')), true);
  assert.equal(isNoteInScope(folder, note('notes/trip/food/thai.md')), true);
  // The trap: the first eleven characters of both paths are the same.
  assert.equal(isNoteInScope(folder, note('notes/trips-2026/day-1.md')), false);
  assert.equal(isNoteInScope(folder, note('notes/trip.md')), false);
  assert.equal(isNoteInScope(folder, note('notes/trip-notes/a.md')), false);
  assert.equal(isNoteInScope(folder, note('notes/tripping.md')), false);
  // A folder that starts with the name of the scope of a parent stays out.
  assert.equal(isNoteInScope(folder, note('trip/day-1.md')), false);
});

await test('a note in the Trash is out of scope', () => {
  const deleted = note('notes/trip/day-1.md', trip, true);
  assert.equal(isNoteInScope(folder, deleted), false);
  assert.equal(isNoteInScope(oneNote, deleted), false);
  // The same note, before it reached the Trash, is in scope.
  assert.equal(isNoteInScope(folder, note('notes/trip/day-1.md')), true);
});

await test('a note link opens one identifier and no other', () => {
  assert.equal(isNoteInScope(oneNote, note('notes/trip/day-1.md')), true);
  assert.equal(
    isNoteInScope(oneNote, note('notes/trip/day-1.md', other)),
    false,
  );
  // A rename keeps the link, because the scope names no path.
  assert.equal(isNoteInScope(oneNote, note('archive/2026/day-1.md')), true);
});

await test('a path that is not a note path is out of scope', () => {
  assert.equal(isNoteInScope(folder, note('notes/trip/photo.png')), false);
  assert.equal(isNoteInScope(oneNote, note('notes/trip/photo.png')), false);
  assert.equal(isNoteInScope(folder, note('notes/trip/.md')), false);
  assert.equal(isNoteInScope(folder, note('notes/trip/a.MD')), false);
  assert.equal(isNoteInScope(folder, note('../secret.md')), false);
  assert.equal(isNoteInScope(folder, note('')), false);
});

await test('the scope reads one spelling of one name', () => {
  // The decomposed spelling of the folder and the composed spelling of the
  // stored path are one name, so the link opens the note.
  const decomposed: PublicationScope = {
    kind: 'folder',
    path: 'notes/cafe\u0301',
  };
  assert.equal(isNoteInScope(decomposed, note('notes/caf\u00e9/a.md')), true);
  const read = normalizeScope(decomposed);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(read.value, { kind: 'folder', path: 'notes/caf\u00e9' });
});

await test('a folder scope keeps every workspace path rule', () => {
  assert.equal(normalizeScope({ kind: 'folder', path: '' }).ok, false);
  assert.equal(normalizeScope({ kind: 'folder', path: '/notes' }).ok, false);
  assert.equal(normalizeScope({ kind: 'folder', path: 'notes/' }).ok, false);
  assert.equal(normalizeScope({ kind: 'folder', path: 'notes/..' }).ok, false);
  assert.equal(normalizeScope({ kind: 'folder', path: 'notes/ x' }).ok, false);
  const refused = normalizeScope({ kind: 'folder', path: 'notes\\trip' });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error.code, 'invalid_path');
  const accepted = normalizeScope(folder);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.deepEqual(accepted.value, folder);
});

await test('a note scope needs an identifier', () => {
  const refused = normalizeScope({ kind: 'note', fileId: '' });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error.code, 'not_found');
  assert.equal(
    isNoteInScope({ kind: 'note', fileId: '' }, note('a.md', '')),
    false,
  );
  const accepted = normalizeScope(oneNote);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.deepEqual(accepted.value, oneNote);
});

await test('the stored prefix of a folder carries its separator', () => {
  assert.equal(folderScopePrefix(folder), 'notes/trip/');
  assert.equal(folderScopePrefix(oneNote), null);
  assert.equal(folderScopePrefix({ kind: 'folder', path: 'notes/' }), null);
});
