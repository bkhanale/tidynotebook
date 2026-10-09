/**
 * The connection pools of this server against a real PostgreSQL service.
 *
 * `openPool` in `packages/storage-server/src/pool.ts` holds two rules: an
 * idle connection that the database ends does not stop the process, and a
 * pool that ends has closed every connection. Every store and the identity
 * pool open their pool there, so this file drives each of them too.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { createAuthPool, loadServerConfig } from '@notesapp/server';
import {
  createDocumentService,
  openIdentityStore,
  openPool,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import {
  createDisposableDatabase,
  openSession,
  testServerUrl,
} from './support/database.ts';

const database = await createDisposableDatabase();

/** Ends every session of the test database, as a restart of the server does. */
async function endEverySession(): Promise<void> {
  const admin = await openSession(testServerUrl());
  try {
    await admin.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() and usename is not null',
      [database.name],
    );
  } finally {
    await admin.close();
  }
}

/** Resolves when one client of a pool has closed its connection. */
function closeOf(client: pg.Client): Promise<void> {
  return new Promise((resolve) => client.once('end', () => resolve()));
}

await test('an ended pool has closed every connection it opened', async () => {
  const pool = openPool({ connectionString: database.runtimeUrl, max: 3 });
  const held = await Promise.all([
    pool.connect(),
    pool.connect(),
    pool.connect(),
  ]);
  const closed = new Set<pg.PoolClient>();
  for (const client of held)
    void closeOf(client).then(() => closed.add(client));
  for (const client of held) client.release();
  await pool.end();
  // A drop of the database right now ends no session that a client of this
  // pool still holds.
  assert.equal(closed.size, held.length);
});

await test('a pool keeps working after the database ends an idle connection', async () => {
  const pool = openPool({ connectionString: database.runtimeUrl, max: 1 });
  try {
    const client = await pool.connect();
    const gone = closeOf(client);
    client.release();
    await endEverySession();
    await gone;
    const answer = await pool.query<{ one: number }>('select 1 as one');
    assert.equal(answer.rows[0]?.one, 1);
  } finally {
    await pool.end();
  }
});

await test('every pool of the server survives the end of its idle connections', async (context) => {
  const closed: Promise<void>[] = [];
  const emit = pg.Pool.prototype.emit;
  // Observe the real clients of all three stores without replacing a query.
  context.mock.method(
    pg.Pool.prototype,
    'emit',
    function (this: pg.Pool, event: string | symbol, ...values: unknown[]) {
      const client = values[0];
      if (event === 'connect' && client instanceof pg.Client)
        closed.push(closeOf(client));
      return emit.call(this, event, ...values);
    },
  );
  const identity = openIdentityStore(database.runtimeUrl, { poolSize: 2 });
  const content = openWorkspaceStore(
    database.runtimeUrl,
    createDocumentService(),
    { poolSize: 2 },
  );
  const auth = createAuthPool(
    loadServerConfig({
      NOTESAPP_ORIGIN: 'http://127.0.0.1',
      NOTESAPP_DATABASE_URL: database.runtimeUrl,
      NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
      NOTESAPP_STORAGE_ROOT: '/tmp',
      NOTESAPP_AUTH_SECRET: 'pool-test-secret-value-0123456789abcdef',
      NOTESAPP_LOG_LEVEL: 'silent',
      NOTESAPP_MAX_BODY_BYTES: '1048576',
      NOTESAPP_MAX_HEADER_BYTES: '16384',
      NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
    }),
  );
  try {
    await identity.hasAccount();
    assert.equal((await content.probeDatabase()).reachable, true);
    await auth.query('select 1');
    assert.equal(closed.length, 3, 'Each store opens its real client.');
    const gone = Promise.all(closed);
    await endEverySession();
    await gone;
    // Each read takes a new connection, and the process is still here.
    assert.equal(await identity.hasAccount(), false);
    assert.equal((await content.probeDatabase()).reachable, true);
    assert.equal((await auth.query('select 1 as one')).rowCount, 1);
  } finally {
    await auth.end();
    await content.close();
    await identity.close();
  }
});

await database.destroy();
