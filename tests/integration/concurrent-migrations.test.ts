/**
 * Two migration runs of one cluster do not block each other.
 *
 * Every browser worker owns its own database, and each of those databases
 * takes the migrations at the same moment. The migration advisory lock
 * belongs to one database, but the runtime role and the identity role are
 * cluster wide objects, so both runs write the same catalog row. This test
 * starts the two runs together and proves that both of them finish.
 *
 * Start the service first:
 *
 * ```sh
 * sudo -n docker compose -f compose.test.yaml up -d --wait
 * ```
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createDocumentService,
  createTestDatabase,
  dropTestDatabase,
  requiredSchemaVersion,
  runMigrations,
  testAuthPassword,
  testRuntimePassword,
} from '@notesapp/storage-server';
import { openSession, testServerUrl } from './support/database.ts';

const serverUrl = testServerUrl();
const names = [0, 1].map(
  () => `notesapp_test_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
);
const urls = await Promise.all(
  names.map(async (name) => await createTestDatabase(serverUrl, name)),
);

test.after(async () => {
  for (const name of names) await dropTestDatabase(serverUrl, name);
});

await test('two databases of one cluster migrate together', async () => {
  const runs = urls.map(
    async (databaseUrl) =>
      await runMigrations({
        documents: createDocumentService(),
        databaseUrl,
        runtimePassword: testRuntimePassword,
        authPassword: testAuthPassword,
      }),
  );
  const results = await Promise.allSettled(runs);
  const refused = results.flatMap((result) =>
    result.status === 'rejected' ? [String(result.reason)] : [],
  );
  assert.deepEqual(refused, []);

  for (const databaseUrl of urls) {
    const session = await openSession(databaseUrl);
    try {
      const rows = await session.query<{ version: number }>(
        'select public.notesapp_schema_version() as version',
      );
      assert.equal(rows[0]?.version, requiredSchemaVersion);
    } finally {
      await session.close();
    }
  }
});
