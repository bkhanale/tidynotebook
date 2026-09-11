/**
 * The database reports the required schema version.
 *
 * `notesapp_schema_version()` is the third copy of the schema version, beside
 * `requiredSchemaVersion` in `migrate.ts` and the journal entry count that
 * `packages/storage-server/src/migrate.test.ts` checks. This test binds the
 * SQL function to the constant against a real migrated database, so the two
 * cannot drift.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { requiredSchemaVersion } from '@notesapp/storage-server';
import { createDisposableDatabase, openSession } from './support/database.ts';

const database = await createDisposableDatabase();
const session = await openSession(database.runtimeUrl);

test.after(async () => {
  await session.close();
  await database.destroy();
});

await test('notesapp_schema_version returns the required version', async () => {
  const rows = await session.query<{ version: number }>(
    'select public.notesapp_schema_version() as version',
  );
  assert.equal(rows[0]?.version, requiredSchemaVersion);
});
