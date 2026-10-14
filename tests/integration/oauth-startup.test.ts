/** OAuth startup seeding is shared by replicas and operator commands. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { configureClient, getOAuthMetadata } from '@notesapp/api-client';
import {
  bootstrapOwner,
  createApp,
  createAuth,
  loadServerConfig,
  recoverAccount,
} from '@notesapp/server';
import {
  createDisposableDatabase,
  openSession,
  type TestDatabase,
} from './support/database.ts';
import { testEnvironment } from './support/server.ts';

const entry = resolve(import.meta.dirname, 'support/oauth-startup-process.ts');
const resource = 'https://mcp.notes.invalid/mcp';

/** Waits for a process or a database state, with a deadline. */
async function until(
  description: string,
  condition: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise<void>((accept) => setTimeout(accept, 10));
  }
  throw new Error(`The OAuth startup test did not reach ${description}.`);
}

function environment(database: TestDatabase, root: string) {
  return {
    ...testEnvironment(root),
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_MCP_ORIGIN: 'https://mcp.notes.invalid',
    NOTESAPP_BREACH_CHECK: 'off',
    NOTESAPP_LOG_LEVEL: 'warn',
  };
}

function startProcess(
  mode: 'app' | 'bootstrap',
  values: Readonly<Record<string, string>>,
) {
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', entry, mode],
    {
      env: { PATH: process.env['PATH'] ?? '', ...values },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  const lines: string[] = [];
  const messages: Record<string, unknown>[] = [];
  const closed = new Promise<number | null>((accept, reject) => {
    child.once('error', reject);
    child.once('close', accept);
  });
  assert.ok(child.stdout !== null && child.stderr !== null);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (line: string) => lines.push(line));
  child.stderr.on('data', (line: string) => lines.push(line));
  child.on('message', (message: unknown) => {
    if (message !== null && typeof message === 'object')
      messages.push(Object.fromEntries(Object.entries(message)));
  });
  return { child, closed, lines, messages };
}

for (const second of ['app', 'bootstrap'] as const) {
  await test(`an app and a second ${second} seed an empty database across processes`, async (t) => {
    const database = await createDisposableDatabase();
    const root = await mkdtemp(join(tmpdir(), 'notesapp-oauth-startup-'));
    const admin = await openSession(database.migrationUrl);
    const gate = await openSession(database.migrationUrl);
    const processes: ReturnType<typeof startProcess>[] = [];
    t.after(async () => {
      await gate.close();
      for (const running of processes) {
        if (running.child.exitCode === null) running.child.kill('SIGKILL');
        await running.closed;
      }
      await admin.close();
      await database.destroy();
      await rm(root, { recursive: true, force: true });
    });
    assert.deepEqual(
      await admin.query('select * from auth_oauth_resource'),
      [],
    );
    // Hold the first insert after its empty read. Without the startup lock,
    // both processes read the missing row before either insert can finish.
    await admin.query(`create function startup_seed_gate() returns trigger
      language plpgsql as $$ begin
        perform pg_advisory_xact_lock(356, 1); return new;
      end $$`);
    await admin.query(`create trigger startup_seed_gate before insert on auth_oauth_resource
      for each row execute function startup_seed_gate()`);
    await gate.query('select pg_advisory_lock(356, 1)');
    processes.push(
      startProcess('app', environment(database, root)),
      startProcess(second, environment(database, root)),
    );
    await until('both processes wait for the start', async () =>
      processes.every((running) =>
        running.messages.some((message) => message.kind === 'waiting'),
      ),
    );
    for (const running of processes) running.child.send('start');
    await until('both startup operations reach a database lock', async () => {
      for (const running of processes)
        assert.equal(running.child.exitCode, null, running.lines.join(''));
      const rows = await admin.query<{ count: number }>(
        `select count(*)::int as count from pg_locks
         where database = (select oid from pg_database where datname = current_database())
           and locktype = 'advisory' and not granted`,
      );
      return rows[0]?.count === 2;
    });
    await gate.query('select pg_advisory_unlock(356, 1)');
    await until('both startup operations complete', async () => {
      for (const running of processes)
        if (!running.messages.some((message) => message.kind === 'ready'))
          assert.equal(running.child.exitCode, null, running.lines.join(''));
      return processes.every((running) =>
        running.messages.some((message) => message.kind === 'ready'),
      );
    });
    for (const running of processes) {
      const ready = running.messages.find(
        (message) => message.kind === 'ready',
      );
      if (typeof ready?.baseUrl === 'string') {
        configureClient(ready.baseUrl, undefined);
        const metadata = await getOAuthMetadata();
        assert.equal(metadata.response?.status, 200, running.lines.join(''));
        assert.equal(metadata.data?.issuer, 'http://127.0.0.1/api/auth');
        running.child.send('stop');
      }
      assert.equal(await running.closed, 0, running.lines.join(''));
      assert.doesNotMatch(running.lines.join(''), /23505|unhandled|seed gate/i);
    }
    const rows = await admin.query<{ identifier: string }>(
      'select identifier from auth_oauth_resource',
    );
    assert.deepEqual(rows, [{ identifier: resource }]);
    if (second === 'bootstrap')
      assert.equal((await admin.query('select id from accounts')).length, 1);
  });
}

await test('a seed failure closes owned pools and stops startup', async (t) => {
  const database = await createDisposableDatabase();
  const root = await mkdtemp(join(tmpdir(), 'notesapp-oauth-failure-'));
  const admin = await openSession(database.migrationUrl);
  t.after(async () => {
    await admin.close();
    await database.destroy();
    await rm(root, { recursive: true, force: true });
  });
  await admin.query(`create function refuse_startup_seed() returns trigger
    language plpgsql as $$ begin raise exception 'private seed failure'; end $$`);
  await admin.query(`create trigger refuse_startup_seed before insert or update
    on auth_oauth_resource for each row execute function refuse_startup_seed()`);
  const values = environment(database, root);
  await t.test(
    'auth, app and CLI failures close every owned pool',
    async () => {
      const config = loadServerConfig(values);
      const attempts = [
        () =>
          createAuth(config, {
            mail: null,
            sessionAllowed: () => Promise.resolve(false),
          }),
        () => createApp(config),
        () =>
          bootstrapOwner({
            config,
            email: 'failed@notes.invalid',
            name: 'Failed owner',
            password: 'oauth-startup-owner-password',
          }),
        () =>
          recoverAccount({
            config,
            email: 'failed@notes.invalid',
            password: 'oauth-startup-owner-password',
          }),
      ];
      for (const attempt of attempts) {
        await assert.rejects(attempt, (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.name, 'AuthInitializationError');
          assert.ok(error.cause instanceof Error);
          return true;
        });
        const sessions = await admin.query<{ count: number }>(
          `select count(*)::int as count from pg_stat_activity
         where datname = current_database() and usename <> current_user`,
        );
        assert.equal(
          sessions[0]?.count,
          0,
          'failed initialization closes its pools',
        );
      }
    },
  );
  await t.test(
    'startup writes one clear message with no unhandled rejection',
    async (t) => {
      const child = spawn(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          resolve(import.meta.dirname, '../../apps/server/src/main.ts'),
        ],
        {
          env: {
            PATH: process.env['PATH'] ?? '',
            ...values,
            NOTESAPP_HOST: '127.0.0.1',
            NOTESAPP_PORT: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const lines: string[] = [];
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (line: string) => lines.push(line));
      child.stderr.on('data', (line: string) => lines.push(line));
      const closed = new Promise<number | null>((accept, reject) => {
        child.once('error', reject);
        child.once('close', accept);
      });
      t.after(async () => {
        if (child.exitCode === null) child.kill('SIGKILL');
        await closed;
      });
      await until(
        'the refused process stops',
        async () => child.exitCode !== null,
      );
      assert.equal(await closed, 1);
      const output = lines.join('');
      assert.equal(output.trim().split('\n').length, 1, output);
      assert.match(output, /notesapp: the server could not start\. Check/);
      assert.doesNotMatch(
        output,
        /private seed failure|unhandled|23505|Drizzle|listening on/i,
      );
    },
  );
  for (const command of ['bootstrap', 'recover-account'] as const) {
    await t.test(
      `${command} writes one safe line for a seed failure`,
      async (t) => {
        const password = 'oauth-startup-owner-password';
        const passwordFile = join(root, `${command}-password`);
        await writeFile(passwordFile, password, { mode: 0o600 });
        const child = spawn(
          process.execPath,
          [
            '--disable-warning=ExperimentalWarning',
            resolve(
              import.meta.dirname,
              `../../apps/server/src/cli/${command}.ts`,
            ),
            '--email',
            'failed@notes.invalid',
          ],
          {
            env: {
              PATH: process.env['PATH'] ?? '',
              ...values,
              [command === 'bootstrap'
                ? 'NOTESAPP_BOOTSTRAP_PASSWORD_FILE'
                : 'NOTESAPP_RECOVERY_PASSWORD_FILE']: passwordFile,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const lines: string[] = [];
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (line: string) => lines.push(line));
        child.stderr.on('data', (line: string) => lines.push(line));
        const closed = new Promise<number | null>((accept, reject) => {
          child.once('error', reject);
          child.once('close', accept);
        });
        t.after(async () => {
          if (child.exitCode === null) child.kill('SIGKILL');
          await closed;
        });
        await until(
          'the refused command stops',
          async () => child.exitCode !== null,
        );
        assert.equal(await closed, 1);
        const output = lines.join('');
        assert.equal(output.trim().split('\n').length, 1, output);
        assert.match(
          output,
          /^notesapp: the identity provider could not start\. Check/,
        );
        for (const privateText of [
          'private seed failure',
          'auth_oauth_resource',
          'insert into',
          'update ',
          'params:',
          resource,
          password,
          loadServerConfig(values).authSecret,
          values.NOTESAPP_DATABASE_URL,
          values.NOTESAPP_AUTH_DATABASE_URL,
          'unhandled',
          'Drizzle',
        ])
          assert.equal(output.includes(privateText), false, privateText);
      },
    );
  }
});
