import assert from 'node:assert/strict';
import test from 'node:test';
import { maxPageSize } from '@notesapp/core';
import {
  fileListLimitNotice,
  fileListPageSize,
  loadBoundedFiles,
  loadNoteList,
  notePhrase,
  type FilePageResult,
  type ReadFilePage,
} from './file-load.ts';

/** A server that always offers one more page, to prove that the loop stops. */
const endlessPages = (
  pageSize: number,
): { readonly read: ReadFilePage<string>; readonly calls: () => number } => {
  let calls = 0;
  const read = (cursor: string | null): Promise<FilePageResult<string>> => {
    const start = cursor === null ? 0 : Number(cursor);
    calls += 1;
    const files = Array.from({ length: pageSize }, (_unused, index) =>
      String(start + index),
    );
    return Promise.resolve({
      files,
      nextCursor: String(start + pageSize),
    });
  };
  return { read, calls: () => calls };
};

await test('the load stops at the bound and asks for no more pages', async () => {
  const server = endlessPages(100);
  const loaded = await loadBoundedFiles(server.read, 1000);
  assert.equal(loaded.files.length, 1000);
  assert.equal(loaded.reachedLimit, true);
  assert.equal(server.calls(), 10);
  assert.equal(loaded.files[0], '0');
  assert.equal(loaded.files[999], '999');
});

await test('a page larger than the rest of the bound is cut to the bound', async () => {
  const server = endlessPages(100);
  const loaded = await loadBoundedFiles(server.read, 250);
  assert.equal(loaded.files.length, 250);
  assert.equal(loaded.reachedLimit, true);
  assert.equal(server.calls(), 3);
});

await test('a bound of no rows asks for no page at all', async () => {
  const server = endlessPages(100);
  const loaded = await loadBoundedFiles(server.read, 0);
  assert.deepEqual(loaded.files, []);
  assert.equal(loaded.reachedLimit, false);
  assert.equal(server.calls(), 0);
});

await test('a list inside the bound keeps every note and reports no bound', async () => {
  let calls = 0;
  const pages: readonly FilePageResult<string>[] = [
    { files: ['a', 'b'], nextCursor: 'p2' },
    { files: ['c'], nextCursor: null },
  ];
  const read = (cursor: string | null): Promise<FilePageResult<string>> => {
    const page = cursor === null ? pages[0] : pages[1];
    calls += 1;
    assert.notEqual(page, undefined);
    return Promise.resolve(page ?? { files: [], nextCursor: null });
  };
  const loaded = await loadBoundedFiles(read, 1000);
  assert.deepEqual(loaded.files, ['a', 'b', 'c']);
  assert.equal(loaded.reachedLimit, false);
  assert.equal(calls, 2);
});

await test('a last page that fills the bound exactly reports no bound', async () => {
  const read = (): Promise<FilePageResult<string>> =>
    Promise.resolve({ files: ['a', 'b', 'c'], nextCursor: null });
  const loaded = await loadBoundedFiles(read, 3);
  assert.deepEqual(loaded.files, ['a', 'b', 'c']);
  assert.equal(loaded.reachedLimit, false);
});

await test('a page with no row stops the loop', async () => {
  let calls = 0;
  const read = (): Promise<FilePageResult<string>> => {
    calls += 1;
    return Promise.resolve({ files: [], nextCursor: 'p2' });
  };
  const loaded = await loadBoundedFiles(read, 1000);
  assert.deepEqual(loaded.files, []);
  assert.equal(loaded.reachedLimit, true);
  assert.equal(calls, 1);
});

await test('the notice says nothing while the list holds every note', () => {
  assert.equal(fileListLimitNotice(12, false), null);
});

await test('the notice states the size of the list and the next action', () => {
  assert.equal(
    fileListLimitNotice(1000, true),
    'The list shows the first 1000 notes. Use search to open a note that is not in the list.',
  );
});

await test('a count carries its whole phrase', () => {
  assert.equal(notePhrase(1), '1 note');
  assert.equal(notePhrase(3), '3 notes');
  assert.equal(
    fileListLimitNotice(1, true)?.startsWith(
      'The list shows the first 1 note.',
    ),
    true,
  );
});

await test('the list of a notes area holds every note of 1010 and more', async () => {
  // Issue 256: All notes showed 1001 of 1011 notes, because the list of the
  // area stopped at maxListedFiles. The tree and All notes render a window of
  // their rows, so the list reads every page (record 0165).
  const total = 1011;
  let calls = 0;
  const read = (cursor: string | null): Promise<FilePageResult<string>> => {
    calls += 1;
    const start = cursor === null ? 0 : Number(cursor);
    const end = Math.min(start + 100, total);
    return Promise.resolve({
      files: Array.from({ length: end - start }, (_unused, index) =>
        String(start + index),
      ),
      nextCursor: end < total ? String(end) : null,
    });
  };
  const loaded = await loadNoteList(read);
  assert.equal(loaded.files.length, total);
  assert.equal(loaded.reachedLimit, false);
  assert.equal(calls, 11);
});

await test('the list of a notes area still stops a server that never ends', async () => {
  const pages = endlessPages(500);
  const loaded = await loadNoteList(pages.read);
  assert.equal(loaded.reachedLimit, true);
  assert.equal(loaded.files.length, 100_000);
  assert.equal(pages.calls(), 200);
});

await test('the list asks for the largest page, so 1010 notes take three calls', async () => {
  // Issue 264. A page of 100 rows made the list of 1010 notes eleven calls
  // one after the other.
  assert.equal(fileListPageSize, maxPageSize);
  const total = 1010;
  let calls = 0;
  const read = (cursor: string | null): Promise<FilePageResult<string>> => {
    calls += 1;
    const start = cursor === null ? 0 : Number(cursor);
    const end = Math.min(start + fileListPageSize, total);
    return Promise.resolve({
      files: Array.from({ length: end - start }, (_unused, index) =>
        String(start + index),
      ),
      nextCursor: end < total ? String(end) : null,
    });
  };
  const loaded = await loadNoteList(read);
  assert.equal(loaded.files.length, total);
  assert.equal(calls, 3);
});
