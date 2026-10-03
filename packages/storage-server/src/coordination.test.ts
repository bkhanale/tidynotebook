/**
 * The answer of an archive job reservation (record 0170, migration 0029).
 *
 * The SQL lives in the migration and `tests/integration/export.test.ts`
 * drives it. This test holds the reading of its row, which PostgreSQL sends
 * with a bigint as a decimal string.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isOperationalError } from '@notesapp/core';
import { archiveReservation } from './coordination.ts';

await test('a reserved job carries the disk of the other running jobs', () => {
  assert.deepEqual(
    archiveReservation({ state: 'reserved', other_disk_bytes: '4294967296' }),
    { state: 'reserved', otherDiskBytes: 4_294_967_296 },
  );
  assert.deepEqual(
    archiveReservation({ state: 'reserved', other_disk_bytes: '0' }),
    { state: 'reserved', otherDiskBytes: 0 },
  );
});

await test('a refused job names the limit that refused it', () => {
  assert.deepEqual(
    archiveReservation({ state: 'account', other_disk_bytes: '0' }),
    { state: 'account' },
  );
  assert.deepEqual(
    archiveReservation({ state: 'installation', other_disk_bytes: '0' }),
    { state: 'installation' },
  );
});

await test('an answer that is not a reservation fails loudly', () => {
  for (const row of [
    {},
    { state: 'other', other_disk_bytes: '0' },
    { state: 'reserved' },
    { state: 'reserved', other_disk_bytes: '-1' },
    { state: 'reserved', other_disk_bytes: '1.5' },
    { state: 'reserved', other_disk_bytes: 12 },
    { state: 'reserved', other_disk_bytes: '9007199254740993' },
  ])
    assert.throws(() => archiveReservation(row), isOperationalError);
});
