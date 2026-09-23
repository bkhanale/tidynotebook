/**
 * Checks that the record steps of the browser store form one chain.
 *
 * A browser opens its store at whatever version the last release left, and
 * `ensureSchema` walks the steps from there to the current version. A version
 * that no step leaves strands every browser that stored it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { schemaVersions } from './database.ts';
import { currentSchemaVersion, migrationSteps } from './migrations.ts';

await test('every released schema version has a step to the next one', () => {
  // Release 0.5.0 added version 5 and no step from version 4, so every
  // browser that ran 0.4 refused its store (record 0088). A new version
  // without its step fails here, before a release can ship it.
  const versions = schemaVersions.map((entry) => entry.version);
  assert.deepEqual(
    versions,
    versions.map((_, index) => index + 1),
    'the schema versions count up from 1 with no gap',
  );
  for (let version = 1; version < currentSchemaVersion; version += 1) {
    const steps = migrationSteps.filter((entry) => entry.from === version);
    assert.equal(
      steps.length,
      1,
      `schema version ${String(version)} has exactly one step`,
    );
    assert.equal(steps[0]?.to, version + 1);
  }
  assert.equal(
    migrationSteps.some((entry) => entry.from >= currentSchemaVersion),
    false,
    'no step leads away from the current schema version',
  );
});
