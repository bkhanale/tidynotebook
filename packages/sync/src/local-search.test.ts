import assert from 'node:assert/strict';
import test from 'node:test';
import { searchLocal } from './local-search.ts';

/** The excerpt as one string, for a readable assertion. */
function excerptText(excerpt: readonly { readonly text: string }[]): string {
  return excerpt.map((part) => part.text).join('');
}

await test('local search requires all words and returns bounded excerpts', () => {
  const hits = searchLocal('offline plan', [
    {
      fileId: 'one',
      path: 'plans/one.md',
      revisionId: 'revision-one',
      text: 'The offline plan keeps work safe.',
    },
    {
      fileId: 'two',
      path: 'other.md',
      revisionId: 'revision-two',
      text: 'Offline only.',
    },
  ]);
  assert.deepEqual(
    hits.map((hit) => hit.fileId),
    ['one'],
  );
  assert.match(excerptText(hits[0]?.excerpt ?? []), /offline plan/i);
});

await test('the excerpt marks every matched word and nothing else', () => {
  const hits = searchLocal('queue', [
    {
      fileId: 'one',
      path: 'one.md',
      revisionId: 'revision-one',
      text: 'The queue keeps the queue safe.',
    },
  ]);
  assert.deepEqual(hits[0]?.excerpt, [
    { text: 'The ', marked: false },
    { text: 'queue', marked: true },
    { text: ' keeps the ', marked: false },
    { text: 'queue', marked: true },
    { text: ' safe.', marked: false },
  ]);
});

await test('a name match ranks above a match in the text alone', () => {
  const hits = searchLocal('kayak', [
    {
      fileId: 'body',
      path: 'a/Boats.md',
      revisionId: 'revision-body',
      text: 'A kayak is a boat. A kayak is not a canoe.',
    },
    {
      fileId: 'name',
      path: 'z/Kayak.md',
      revisionId: 'revision-name',
      text: 'Nothing about boats here.',
    },
  ]);
  assert.deepEqual(
    hits.map((hit) => hit.fileId),
    ['name', 'body'],
  );
});

await test('a later draft replaces the accepted state of one file', () => {
  const hits = searchLocal('draft-only', [
    {
      fileId: 'one',
      path: 'one.md',
      revisionId: 'accepted',
      text: 'accepted-only',
    },
    {
      fileId: 'one',
      path: 'renamed.md',
      revisionId: 'draft',
      text: 'draft-only',
    },
  ]);
  assert.deepEqual(hits, [
    {
      fileId: 'one',
      path: 'renamed.md',
      revisionId: 'draft',
      excerpt: [{ text: 'draft-only', marked: true }],
    },
  ]);
  assert.deepEqual(
    searchLocal(
      'accepted-only',
      hits.map(() => ({
        fileId: 'one',
        path: 'renamed.md',
        revisionId: 'draft',
        text: 'draft-only',
      })),
    ),
    [],
  );
});
