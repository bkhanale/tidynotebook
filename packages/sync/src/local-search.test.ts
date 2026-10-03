import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReadableCache,
  localSearchLimit,
  maxParsesPerQuery,
  searchLocal,
  type LocalSearchFile,
} from './local-search.ts';

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

await test('the excerpt is the plain text of the note, with no Markdown', () => {
  // Issue 253. The window was cut from the Markdown of the note, so a palette
  // result showed `**` marks and whole link addresses.
  const hits = searchLocal('portage', [
    {
      fileId: 'one',
      path: 'trips/Canoe.md',
      revisionId: 'revision-one',
      text: '# Canoe\n\nThe **portage** route is in [the trip plan](https://maps.example.com/routes/trail).\n',
    },
  ]);
  // The first heading repeats the name the excerpt is shown under, so it
  // goes.
  assert.deepEqual(hits[0]?.excerpt, [
    { text: 'The ', marked: false },
    { text: 'portage', marked: true },
    { text: ' route is in the trip plan.', marked: false },
  ]);
});

await test('a heading of another name stays as its own block', () => {
  const hits = searchLocal('portage', [
    {
      fileId: 'one',
      path: 'trips/Canoe.md',
      revisionId: 'revision-one',
      text: '# Routes\n\nThe **portage** route.\n',
    },
  ]);
  assert.equal(
    (hits[0]?.excerpt ?? []).map((part) => part.text).join(''),
    'Routes · The portage route.',
  );
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

await test('a word only in a link address finds nothing, as on the server', () => {
  // Records 0162 and 0167. The device reads the same readable text that the
  // server index holds, so both answer one query alike.
  const hits = searchLocal('hidden', [
    {
      fileId: 'one',
      path: 'Links.md',
      revisionId: 'revision-one',
      text: 'Read [the guide](https://example.com/hidden/guide) today.\n',
    },
  ]);
  assert.deepEqual(hits, []);
});

await test('a word that the Markdown writes in parts is found as a reader reads it', () => {
  // Review of records 0162 and 0167. A filter over the raw Markdown dropped a
  // note before its readable text was read, so an entity, an escape and a
  // mark inside a word were found by the server index and not here.
  const files = [
    {
      fileId: 'one',
      path: 'a/One.md',
      revisionId: 'r1',
      text: 'AT&amp;T bought it.\n',
    },
    {
      fileId: 'two',
      path: 'a/Two.md',
      revisionId: 'r2',
      text: 'Call foo\\_bar first.\n',
    },
    {
      fileId: 'three',
      path: 'a/Three.md',
      revisionId: 'r3',
      text: 'It was un**believ**able.\n',
    },
  ];
  const cache = createReadableCache();
  assert.deepEqual(
    searchLocal('at&t', files, cache).map((hit) => hit.fileId),
    ['one'],
  );
  assert.deepEqual(
    searchLocal('foo_bar', files, cache).map((hit) => hit.fileId),
    ['two'],
  );
  assert.deepEqual(
    searchLocal('unbelievable', files, cache).map((hit) => hit.fileId),
    ['three'],
  );
});

/** A workspace of `count` short notes that no query word below matches. */
function workspace(count: number): readonly LocalSearchFile[] {
  return Array.from({ length: count }, (_, index) => ({
    fileId: `file-${String(index)}`,
    path: `notes/note-${String(index).padStart(5, '0')}.md`,
    revisionId: `revision-${String(index)}`,
    text: `# Note ${String(index)}\n\nA line of text.\n`,
  }));
}

await test('a query parses a bounded number of notes and each revision once', () => {
  // Review of records 0162 and 0167. Each key parsed every note that passed
  // the filter, on the main thread, with no bound: 5000 parses for a query
  // over 5000 notes, and as many again for the next key.
  const files = workspace(5000);
  const cache = createReadableCache();
  assert.deepEqual(searchLocal('zebra', files, cache), []);
  assert.equal(cache.parses(), maxParsesPerQuery);
  // The next keys read the next notes and none of the notes already read.
  for (let key = 1; key * maxParsesPerQuery < 5000; key += 1)
    searchLocal('zebra', files, cache);
  assert.equal(cache.parses(), 5000);
  // Once every revision is read, a query parses nothing.
  searchLocal('line', files, cache);
  searchLocal('zebra', files, cache);
  assert.equal(cache.parses(), 5000);
});

await test('a query that matches every note stops at the limit of its answer', () => {
  const files = workspace(5000);
  const cache = createReadableCache();
  assert.equal(searchLocal('line', files, cache).length, localSearchLimit);
  assert.equal(cache.parses(), localSearchLimit);
});

await test('a changed draft is read again and a hit keeps its entry', () => {
  const cache = createReadableCache(2);
  const first = { fileId: 'a', path: 'A.md', revisionId: 'r', text: 'alpha' };
  const second = { fileId: 'b', path: 'B.md', revisionId: 'r', text: 'beta' };
  const third = { fileId: 'c', path: 'C.md', revisionId: 'r', text: 'gamma' };
  searchLocal('x', [first, second], cache);
  assert.equal(cache.parses(), 2);
  // A hit on the first moves it to the end, so the second goes for the third.
  assert.equal(cache.cached(first), 'alpha');
  cache.read(third);
  assert.equal(cache.cached(first), 'alpha');
  assert.equal(cache.cached(second), null);
  // A draft keeps its revision and changes its text, so it is read again.
  assert.equal(cache.cached({ ...first, text: 'alpha two' }), null);
});

await test('a note whose HTML nests too deep is found by its source and fails no search', () => {
  // Review of the audit of 2026-10-02. The plain text read the HTML of a
  // note with no bound, so 5000 nested elements threw a RangeError, which
  // this search threw again, and the search of the whole device failed. The
  // grammar now refuses the note with its limit error, as the renderer
  // does, and the note is searched as it is written.
  const files: readonly LocalSearchFile[] = [
    {
      fileId: 'deep',
      path: 'Deep.md',
      revisionId: 'r1',
      text: `Lighthouse log\n\n${'<div>'.repeat(5000)}x\n`,
    },
    {
      fileId: 'plain',
      path: 'Plain.md',
      revisionId: 'r2',
      text: 'The lighthouse keeper.\n',
    },
  ];
  assert.deepEqual(
    searchLocal('lighthouse', files)
      .map((hit) => hit.fileId)
      .toSorted(),
    ['deep', 'plain'],
  );
});
