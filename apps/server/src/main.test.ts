import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

/**
 * The source of the one module that owns the console of this server.
 *
 * `main.ts` calls `process.exit`, so a test cannot run it and read the
 * result, and the rule that matters here is a rule about the words and not
 * about the run.
 */
async function mainSource(): Promise<string> {
  return await readFile(resolve(import.meta.dirname, 'main.ts'), 'utf8');
}

await test('the operator reads no engine notice', async () => {
  // The defect this covers: a failed build of the application wrote the
  // message of whatever threw straight out. That message belongs to a driver
  // or to the operating system, so it carries a code and sometimes a stack,
  // and the root AGENTS.md states that an operator never reads one.
  const source = await mainSource();
  assert.ok(
    !source.includes('error.message'),
    'main.ts writes the message of a failure to the operator',
  );
  assert.ok(
    !source.includes('String(error)'),
    'main.ts writes an unknown failure value to the operator',
  );
});

await test('a failed start states where the operator looks', async () => {
  const source = await mainSource();
  const line = source
    .split('\n')
    .find((text) => text.includes('the server could not start'));
  assert.ok(line !== undefined, 'no message covers a failed start');
  // A message states what happened and what the person can do next.
  assert.match(line, /database/);
  assert.match(line, /NOTESAPP_STORAGE_ROOT/);
});

await test('a configuration that cannot be read states where to look', async () => {
  const source = await mainSource();
  const line = source
    .split('\n')
    .find((text) => text.includes('the configuration could not be read'));
  assert.ok(
    line !== undefined,
    'no message covers an unreadable configuration',
  );
  assert.match(line, /NOTESAPP_/);
});
