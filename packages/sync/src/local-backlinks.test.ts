import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';
import { localBacklinks } from './local-backlinks.ts';
import type { LocalSearchFile } from './local-search.ts';

/** One local row, with the identifier and the revision a store would give. */
function file(fileId: string, path: string, text: string): LocalSearchFile {
  return { fileId, path, revisionId: `${fileId}-rev`, text };
}

/** The paths of the answer, or a marker when the device has no answer. */
function paths(found: readonly { path: string }[] | null): readonly string[] {
  return found === null ? ['<no answer>'] : found.map((item) => item.path);
}

test('a plain relative link makes a backlink', () => {
  const found = localBacklinks('target', [
    file('target', 'imported/friend.md', '# Friend\n'),
    file('source', 'plan.md', '[Friend](imported/friend.md)\n'),
    file('other', 'diary.md', 'Nothing here.\n'),
  ]);
  deepStrictEqual(paths(found), ['plan.md']);
});

test('the decomposed spelling of a name makes a backlink', () => {
  // The stored path keeps the composed form. The body writes the same name
  // with a combining accent, which the resolver composes before it compares.
  const composed = 'caf\u00e9.md';
  const decomposed = 'cafe\u0301.md';
  const found = localBacklinks('target', [
    file('target', composed, '# Cafe\n'),
    file('source', 'plan.md', `[Cafe](${decomposed})\n`),
  ]);
  deepStrictEqual(paths(found), ['plan.md']);
});

test('the canonical percent encoded name makes a backlink', () => {
  const found = localBacklinks('target', [
    file('target', 'team notes.md', '# Team\n'),
    file('source', 'plan.md', '[Team](team%20notes.md)\n'),
  ]);
  deepStrictEqual(paths(found), ['plan.md']);
});

test('a name hidden behind any escape makes a backlink', () => {
  // `%65` is `e`. No scan of the name finds this body, so the percent sign
  // sends it to the parse and the resolver decodes the destination.
  const found = localBacklinks('target', [
    file('target', 'friend.md', '# Friend\n'),
    file('source', 'plan.md', '[Friend](fri%65nd.md)\n'),
  ]);
  deepStrictEqual(paths(found), ['plan.md']);
});

test('a name in prose is not a link', () => {
  const found = localBacklinks('target', [
    file('target', 'friend.md', '# Friend\n'),
    file('source', 'plan.md', 'Read friend.md one day.\n'),
  ]);
  deepStrictEqual(paths(found), []);
});

test('a link to another folder with the same name is not a backlink', () => {
  const found = localBacklinks('target', [
    file('target', 'work/friend.md', '# Friend\n'),
    file('source', 'plan.md', '[Friend](home/friend.md)\n'),
  ]);
  deepStrictEqual(paths(found), []);
});

test('a relative link from a folder resolves to the target', () => {
  const found = localBacklinks('target', [
    file('target', 'work/friend.md', '# Friend\n'),
    file('source', 'work/notes/plan.md', '[Friend](../friend.md)\n'),
  ]);
  deepStrictEqual(paths(found), ['work/notes/plan.md']);
});

test('the device has no answer for a note it does not hold', () => {
  const found = localBacklinks('missing', [
    file('source', 'plan.md', '[Friend](friend.md)\n'),
  ]);
  strictEqual(found, null);
});

test('a link reference definition makes a backlink', () => {
  const found = localBacklinks('target', [
    file('target', 'friend.md', '# Friend\n'),
    file('source', 'plan.md', 'See [friend][a].\n\n[a]: friend.md\n'),
  ]);
  deepStrictEqual(paths(found), ['plan.md']);
});

test('the last state of a file wins, so a draft can add a link', () => {
  const found = localBacklinks('target', [
    file('target', 'friend.md', '# Friend\n'),
    file('source', 'plan.md', 'Nothing yet.\n'),
    file('source', 'plan.md', '[Friend](friend.md)\n'),
  ]);
  deepStrictEqual(paths(found), ['plan.md']);
});

test('the last state of a file wins, so a draft can remove a link', () => {
  const found = localBacklinks('target', [
    file('target', 'friend.md', '# Friend\n'),
    file('source', 'plan.md', '[Friend](friend.md)\n'),
    file('source', 'plan.md', 'Nothing now.\n'),
  ]);
  deepStrictEqual(paths(found), []);
});

test('the answer is ordered by path, as the server index is', () => {
  const link = '[Friend](friend.md)\n';
  const found = localBacklinks('target', [
    file('target', 'friend.md', '# Friend\n'),
    file('b', 'b.md', link),
    file('a', 'a.md', link),
    file('c', 'c.md', link),
  ]);
  deepStrictEqual(paths(found), ['a.md', 'b.md', 'c.md']);
});

test('an external address and an attachment are not backlinks', () => {
  const found = localBacklinks('target', [
    file('target', 'friend.md', '# Friend\n'),
    file(
      'source',
      'plan.md',
      '[Friend](https://example.test/friend.md)\n\n![x](images/friend.md.png)\n',
    ),
  ]);
  deepStrictEqual(paths(found), []);
});

test('a body the parser refuses does not stop the answer', () => {
  // The shared parser refuses a document above one mebibyte. The filter sends
  // this one to the parse, because it holds the name, and the derivation
  // states the rest of its answer instead of failing.
  const huge = `[Friend](friend.md)\n${'a'.repeat(1024 * 1024 + 1)}`;
  const found = localBacklinks('target', [
    file('target', 'friend.md', '# Friend\n'),
    file('huge', 'huge.md', huge),
    file('source', 'plan.md', '[Friend](friend.md)\n'),
  ]);
  deepStrictEqual(paths(found), ['plan.md']);
});

test('a note that links to itself is listed, as the server index lists it', () => {
  const found = localBacklinks('target', [
    file('target', 'friend.md', '[Itself](friend.md)\n'),
  ]);
  deepStrictEqual(paths(found), ['friend.md']);
});
