/**
 * The teardown of one disposable database.
 *
 * A browser run held the whole gate hostage once: 195 journeys passed and the
 * run still exited 1, with "1 error was not a part of any test". A connection
 * outlived the stack that opened it, the drop carried `WITH (FORCE)`, and the
 * client on the other end raised an error of its own after its test had
 * finished. This file holds the order that answers it: every session of the
 * database ends inside the drop, which the teardown awaits and owns.
 *
 * Start the service first:
 *
 * ```sh
 * sudo -n docker compose -f compose.test.yaml up -d --wait
 * ```
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { createDisposableDatabase } from './support/database.ts';

await test('a drop ends the sessions that a test left open', async () => {
  const database = await createDisposableDatabase();
  // One session that nobody closed, which is the shape the defect needed.
  const left = new pg.Client({ connectionString: database.runtimeUrl });
  const failures: string[] = [];
  left.on('error', (error: Error) => {
    failures.push(error.message);
  });
  await left.connect();
  assert.equal((await left.query('select 1 as one')).rows[0]?.one, 1);

  // The drop ends that session. The client learns about it inside this call,
  // so the failure belongs to the teardown and to no test after it.
  await database.destroy();
  await new Promise((accept) => setTimeout(accept, 200));

  // The session is gone: the client cannot query the database any more.
  await assert.rejects(async () => {
    await left.query('select 1 as one');
  });
  await left.end().catch(() => undefined);
});

await test('a drop of a quiet database ends it without a signal', async () => {
  const database = await createDisposableDatabase();
  const session = new pg.Client({ connectionString: database.runtimeUrl });
  await session.connect();
  await session.end();
  // Nothing is attached, so the drop needs no forced form and raises nothing.
  await database.destroy();
});
