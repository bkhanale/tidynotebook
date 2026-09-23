import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReviewRecord } from '@notesapp/sync';
import { reviewNotice, reviewPage } from './review.ts';

/** One merge event, as the store lists it. */
function merge(reviewId: string, text: string | null): ReviewRecord {
  return {
    reviewId,
    fileId: 'file-1',
    cause: { kind: 'merge', revisionId: `revision-${reviewId}` },
    text,
    createdAt: '2026-09-23T10:00:00.000Z',
  };
}

/** One recovery event, as the store lists it. */
function recovery(reviewId: string, text: string | null): ReviewRecord {
  return {
    reviewId,
    fileId: 'file-1',
    cause: { kind: 'recovery', recoveryId: reviewId },
    text,
    createdAt: '2026-09-23T10:00:00.000Z',
  };
}

/** Every sentence that the rule can give a person. */
function sentencesOf(review: ReviewRecord): readonly string[] {
  const page = reviewPage(review);
  return [
    reviewNotice([review])?.message ?? '',
    page.title,
    page.description,
    page.keptLabel,
    page.currentLabel,
    page.sameText,
    page.missing ?? '',
  ];
}

await test('a note with no waiting event offers no Review', () => {
  assert.equal(reviewNotice([]), null);
});

await test('the note offers the event that waited longest, one at a time', () => {
  // The store lists the events oldest first. Clearing the first one leaves
  // the second, so a later merge can offer Review again.
  const waiting = [merge('older', 'a\n'), merge('newer', 'a\nb\n')];
  assert.equal(reviewNotice(waiting)?.reviewId, 'older');
  assert.equal(reviewNotice(waiting.slice(1))?.reviewId, 'newer');
});

await test('a merge and a kept text each have one message', () => {
  assert.equal(
    reviewNotice([merge('m', 'a\n')])?.message,
    'This note has changes from another device.',
  );
  assert.equal(
    reviewNotice([recovery('r', 'a\n')])?.message,
    'Earlier work on this device did not go into this note. Needs attention keeps it.',
  );
});

await test('a merge compares the save of this device with the note now', () => {
  const page = reviewPage(merge('m', 'a\n'));
  assert.equal(page.keptLabel, 'Your save');
  assert.equal(page.currentLabel, 'The note now');
  assert.equal(page.missing, null);
  // The work of both devices is in the note, so nothing waits for a choice.
  assert.equal(page.opensAttention, false);
});

await test('a kept text has one action, which opens Needs attention', () => {
  const page = reviewPage(recovery('r', 'a\n'));
  assert.equal(page.keptLabel, 'Earlier work');
  assert.equal(page.opensAttention, true);
  assert.equal(page.missing, null);
});

await test('an event whose text is gone says so instead of comparing', () => {
  assert.equal(
    reviewPage(merge('m', null)).missing,
    'The text of your save is not on this device any more.',
  );
  assert.equal(
    reviewPage(recovery('r', null)).missing,
    'The earlier work is not on this device any more.',
  );
});

await test('no sentence names an identifier, a suffix, or an engine word', () => {
  for (const review of [
    merge('m', 'a\n'),
    merge('m', null),
    recovery('r', 'a\n'),
    recovery('r', null),
  ])
    for (const sentence of sentencesOf(review)) {
      assert.doesNotMatch(sentence, /revision-|\.md\b|merge|CRDT|Yjs/i);
      assert.doesNotMatch(sentence, /[—–]/);
    }
});
