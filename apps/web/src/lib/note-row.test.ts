/**
 * Note row unit tests.
 *
 * The row states the name, the folder, and the relative time. The name drops
 * the folder and the `.md` suffix, a top level note has no folder, and the
 * time reads the way the rest of the interface states it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { noteRowMeta } from './note-row.ts';

const now = Date.parse('2026-09-12T12:00:00.000Z');

await test('a note in a folder shows the name, the folder, and the time', () => {
  const meta = noteRowMeta(
    'Work/Reports/Q1.md',
    '2026-09-12T11:59:30.000Z',
    now,
  );
  assert.equal(meta.name, 'Q1');
  assert.equal(meta.folder, 'Work/Reports');
  assert.equal(meta.when, 'just now');
});

await test('a top level note has no folder', () => {
  const meta = noteRowMeta('Ideas.md', '2026-09-11T12:00:00.000Z', now);
  assert.equal(meta.name, 'Ideas');
  assert.equal(meta.folder, null);
  assert.equal(meta.when, 'yesterday');
});

await test('an unreadable instant leaves the time empty', () => {
  const meta = noteRowMeta('Ideas.md', 'not-a-date', now);
  assert.equal(meta.when, '');
});
