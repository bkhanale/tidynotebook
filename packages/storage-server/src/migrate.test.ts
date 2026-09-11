/**
 * The schema version has three copies that must agree.
 *
 * `requiredSchemaVersion` in `migrate.ts`, the entry count in
 * `migrations/meta/_journal.json`, and the number that
 * `notesapp_schema_version()` returns all describe the same set. This unit
 * test binds the constant to the journal count. The integration test in
 * `tests/integration/schema-version.test.ts` binds it to the SQL function.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { requiredSchemaVersion } from './migrate.ts';

/** Reads the number of applied entries from a parsed migration journal. */
function journalEntryCount(value: unknown): number {
  if (
    typeof value === 'object' &&
    value !== null &&
    'entries' in value &&
    Array.isArray(value.entries)
  ) {
    return value.entries.length;
  }
  throw new Error('notesapp: the migration journal has no entries array.');
}

const entryCount = journalEntryCount(
  JSON.parse(
    await readFile(
      fileURLToPath(
        new URL('../migrations/meta/_journal.json', import.meta.url),
      ),
      'utf8',
    ),
  ),
);

await test('requiredSchemaVersion equals the journal entry count', () => {
  assert.equal(entryCount, requiredSchemaVersion);
});
