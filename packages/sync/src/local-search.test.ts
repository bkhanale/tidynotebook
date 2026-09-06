import assert from 'node:assert/strict';
import test from 'node:test';
import { searchLocal } from './local-search.ts';

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
  assert.match(hits[0]?.excerpt ?? '', /offline plan/i);
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
      excerpt: 'draft-only',
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
