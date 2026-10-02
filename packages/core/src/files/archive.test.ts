/** Checks the bounds of a workspace archive (issue 243). */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveBytesAllowed,
  archiveEntriesAllowed,
  maxArchiveBytes,
  maxArchiveEntries,
} from './archive.ts';
import { maxFilesPerChangeset } from './commit.ts';

await test('an archive takes every count that the zip format counts', () => {
  // The format counts files in 16 bits, so export writes at most 65535.
  assert.equal(maxArchiveEntries, 65_535);
  assert.equal(archiveEntriesAllowed(0), true);
  assert.equal(archiveEntriesAllowed(maxFilesPerChangeset + 1), true);
  assert.equal(archiveEntriesAllowed(maxArchiveEntries), true);
});

await test('an archive takes every size that the zip format addresses', () => {
  // The format addresses bytes in 32 bits. The import bound was 100 MiB,
  // so an export of more bytes could not come back (issue 243).
  assert.equal(maxArchiveBytes, 2 ** 32 - 1);
  assert.equal(archiveBytesAllowed(100 * 1024 * 1024 + 1), true);
  assert.equal(archiveBytesAllowed(maxArchiveBytes), true);
});

await test('an archive past a bound is refused', () => {
  assert.equal(archiveEntriesAllowed(maxArchiveEntries + 1), false);
  assert.equal(archiveEntriesAllowed(-1), false);
  assert.equal(archiveEntriesAllowed(1.5), false);
  assert.equal(archiveEntriesAllowed(Number.NaN), false);
  assert.equal(archiveBytesAllowed(maxArchiveBytes + 1), false);
  assert.equal(archiveBytesAllowed(-1), false);
});
