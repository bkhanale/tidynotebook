import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeHits,
  rankActions,
  rankNotes,
  type PaletteAction,
  type PaletteHit,
  type PaletteNote,
} from './palette-items.ts';

const notes: readonly PaletteNote[] = [
  { fileId: 'a', path: 'plans/roadmap.md', updatedAt: '2026-01-03T00:00:00Z' },
  { fileId: 'b', path: 'roadmap notes.md', updatedAt: '2026-01-05T00:00:00Z' },
  { fileId: 'c', path: 'shopping.md', updatedAt: '2026-01-04T00:00:00Z' },
];

const hits: readonly PaletteHit[] = [
  { fileId: 'c', path: 'shopping.md', excerpt: 'the roadmap is in the fridge' },
  { fileId: 'a', path: 'plans/roadmap.md', excerpt: 'roadmap of the year' },
];

await test('an empty query lists the notes that changed last', () => {
  const ranked = rankNotes('', notes, [], 2);
  assert.deepEqual(
    ranked.map((match) => match.fileId),
    ['b', 'c'],
  );
  assert.equal(ranked[0]?.excerpt, null);
});

await test('a name match comes before a content match', () => {
  const ranked = rankNotes('roadmap', notes, hits, 10);
  assert.deepEqual(
    ranked.map((match) => match.fileId),
    ['b', 'a', 'c'],
  );
  assert.equal(ranked[0]?.excerpt, null);
  assert.equal(ranked[1]?.excerpt, null);
  assert.equal(ranked[2]?.excerpt, 'the roadmap is in the fridge');
});

await test('a note that matches twice is listed once', () => {
  const ranked = rankNotes('roadmap', notes, hits, 10);
  const seen = new Set(ranked.map((match) => match.fileId));
  assert.equal(seen.size, ranked.length);
});

await test('server and local hits merge with the local one winning', () => {
  const merged = mergeHits(
    [{ fileId: 'a', path: 'a.md', excerpt: 'old' }],
    [{ fileId: 'a', path: 'a.md', excerpt: 'new' }],
  );
  assert.deepEqual(merged, [{ fileId: 'a', path: 'a.md', excerpt: 'new' }]);
});

const actions: readonly PaletteAction[] = [
  { id: 'new', label: 'New note', run: () => {} },
  { id: 'theme', label: 'Toggle theme', keywords: 'dark light', run: () => {} },
  { id: 'trash', label: 'Go to Trash', run: () => {} },
];

await test('an empty query keeps every action', () => {
  assert.equal(rankActions('', actions).length, 3);
});

await test('an action is found by its label and by its keywords', () => {
  assert.deepEqual(
    rankActions('dark', actions).map((action) => action.id),
    ['theme'],
  );
  assert.deepEqual(
    rankActions('trash', actions).map((action) => action.id),
    ['trash'],
  );
  assert.deepEqual(rankActions('nothing here', actions), []);
});
