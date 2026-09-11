import assert from 'node:assert/strict';
import test from 'node:test';
import { folderOf, relativeTime } from './relative-time.ts';

const now = Date.parse('2026-09-10T12:00:00.000Z');

await test('a recent instant reads as just now', () => {
  assert.equal(relativeTime('2026-09-10T12:00:00.000Z', now), 'just now');
  assert.equal(relativeTime('2026-09-10T11:59:30.000Z', now), 'just now');
});

await test('an older instant reads in the largest unit that fits', () => {
  assert.equal(relativeTime('2026-09-10T11:55:00.000Z', now), '5 minutes ago');
  assert.equal(relativeTime('2026-09-10T09:00:00.000Z', now), '3 hours ago');
  assert.equal(relativeTime('2026-09-08T12:00:00.000Z', now), '2 days ago');
  assert.equal(relativeTime('2026-06-12T12:00:00.000Z', now), '3 months ago');
  assert.equal(relativeTime('2024-09-10T12:00:00.000Z', now), '2 years ago');
});

await test('an unreadable instant reads as nothing', () => {
  assert.equal(relativeTime('not a time', now), '');
  assert.equal(relativeTime('', now), '');
});

await test('a folder is the path without the note name', () => {
  assert.equal(folderOf('projects/plan.md'), 'projects');
  assert.equal(folderOf('a/b/plan.md'), 'a/b');
  assert.equal(folderOf('plan.md'), null);
});
