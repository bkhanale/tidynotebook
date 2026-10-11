import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { operations } from '@notesapp/api-contract';
import { generateInto } from './generate.ts';
import { outputDirectories } from './paths.ts';

await test('generation publishes the merged client document with every runtime operation and security rule', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'notesapp-reference-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await generateInto(root);
  const document: unknown = JSON.parse(
    await readFile(
      join(outputDirectories(root).contract, 'openapi.json'),
      'utf8',
    ),
  );
  assert.ok(
    typeof document === 'object' &&
      document !== null &&
      'paths' in document &&
      'security' in document,
  );
  const paths = document.paths;
  assert.ok(typeof paths === 'object' && paths !== null);
  const ids: string[] = [];
  for (const operation of operations) {
    const item: unknown = Reflect.get(paths, operation.path);
    assert.ok(typeof item === 'object' && item !== null, operation.path);
    const entry: unknown = Reflect.get(item, operation.method);
    assert.ok(
      typeof entry === 'object' && entry !== null && 'operationId' in entry,
    );
    assert.equal(entry.operationId, operation.id);
    assert.deepEqual(
      'security' in entry ? entry.security : document.security,
      operation.security,
      operation.id,
    );
    ids.push(operation.id);
  }
  assert.ok(
    ids.includes('signInWithPassword'),
    'the authentication fragment is present',
  );
  const found = Object.values(paths).flatMap((item: unknown) =>
    typeof item === 'object' && item !== null
      ? Object.values(item).flatMap((entry: unknown) =>
          typeof entry === 'object' && entry !== null && 'operationId' in entry
            ? [entry.operationId]
            : [],
        )
      : [],
  );
  assert.equal(found.length, operations.length);
});
