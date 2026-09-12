/**
 * Note group unit tests.
 *
 * The bands run from Today to Older by elapsed time, the empty bands drop
 * out, and each band keeps the newest note first.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { groupNotesByRecency } from './note-groups.ts';
import type { NoteSummary } from './note-list.ts';

const now = Date.parse('2026-09-12T12:00:00.000Z');

function note(fileId: string, updatedAt: string): NoteSummary {
  return {
    fileId,
    path: `${fileId}.md`,
    updatedAt,
    localOnly: false,
    unsent: false,
  };
}

const hour = 3_600_000;
const day = 24 * hour;

await test('notes fall into the right bands, newest first', () => {
  const groups = groupNotesByRecency(
    [
      note('a', new Date(now - 2 * hour).toISOString()),
      note('b', new Date(now - 30 * hour).toISOString()),
      note('c', new Date(now - 3 * day).toISOString()),
      note('d', new Date(now - 20 * day).toISOString()),
      note('e', new Date(now - 200 * day).toISOString()),
      note('f', new Date(now - 1 * hour).toISOString()),
    ],
    now,
  );
  assert.deepEqual(
    groups.map((group) => group.label),
    ['Today', 'Yesterday', 'Earlier this week', 'Earlier this month', 'Older'],
  );
  // The Today band holds both today notes, the newest one first.
  assert.deepEqual(
    groups[0]?.notes.map((n) => n.fileId),
    ['f', 'a'],
  );
});

await test('an empty band does not appear', () => {
  const groups = groupNotesByRecency(
    [note('a', new Date(now - 2 * hour).toISOString())],
    now,
  );
  assert.deepEqual(
    groups.map((group) => group.label),
    ['Today'],
  );
});

await test('an unreadable instant falls in the oldest band', () => {
  const groups = groupNotesByRecency([note('a', 'not-a-date')], now);
  assert.deepEqual(
    groups.map((group) => group.label),
    ['Older'],
  );
});
