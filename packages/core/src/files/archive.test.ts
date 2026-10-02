/** Checks the bounds of a workspace archive (issue 243). */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveEntriesAllowed,
  maxArchiveEntries,
  maxArchiveExpandedBytes,
} from './archive.ts';
import { maxFilesPerChangeset } from './commit.ts';

await test('an archive takes every count that the zip format counts', () => {
  // The format counts files in 16 bits, so export writes at most 65535.
  assert.equal(maxArchiveEntries, 65_535);
  assert.equal(archiveEntriesAllowed(0), true);
  assert.equal(archiveEntriesAllowed(maxFilesPerChangeset + 1), true);
  assert.equal(archiveEntriesAllowed(maxArchiveEntries), true);
});

await test('an archive past the bound is refused', () => {
  assert.equal(archiveEntriesAllowed(maxArchiveEntries + 1), false);
  assert.equal(archiveEntriesAllowed(-1), false);
  assert.equal(archiveEntriesAllowed(1.5), false);
  assert.equal(archiveEntriesAllowed(Number.NaN), false);
});

await test('the expanded bound is a whole number of mebibytes', () => {
  assert.equal(maxArchiveExpandedBytes % (1024 * 1024), 0);
  assert.ok(maxArchiveExpandedBytes > 0);
});
