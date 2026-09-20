import assert from 'node:assert/strict';
import test from 'node:test';
import { folderOf, relativeTime, relativeTimeStepMs } from './relative-time.ts';

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

await test('the phrase of one instant changes as the clock moves', () => {
  // A screen that stays open reads the clock again every step, so the row
  // follows the clock instead of holding the phrase it first drew.
  const instant = '2026-09-10T12:00:00.000Z';
  assert.equal(relativeTime(instant, now), 'just now');
  assert.equal(relativeTime(instant, now + 61_000), '1 minute ago');
  assert.equal(relativeTime(instant, now + 3_660_000), '1 hour ago');
});

await test('the step of the clock skips no phrase of the scale', () => {
  // The first phrase changes after one minute. A step longer than that could
  // step over a whole phrase, and a step of zero would never end.
  assert.ok(relativeTimeStepMs > 0);
  assert.ok(relativeTimeStepMs <= 60_000);
});

await test('a folder is the path without the note name', () => {
  assert.equal(folderOf('projects/plan.md'), 'projects');
  assert.equal(folderOf('a/b/plan.md'), 'a/b');
  assert.equal(folderOf('plan.md'), null);
});
