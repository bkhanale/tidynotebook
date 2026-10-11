/**
 * A start that the configuration refuses names the setting to the operator.
 *
 * `apps/server/src/main.ts` used to replace every failure of `createApp` with
 * one general sentence about the database, the storage and the mail. A
 * configuration error that only the composition can find, such as an
 * operator secret of the wrong length, then never named its variable, and the
 * operator of a platform read a sentence that pointed at the wrong place.
 *
 * This file runs the real entry point as its own process against a real
 * database, with an operator token file that holds a secret that is too
 * short, and reads what the process writes before it stops. Since record
 * 0207 the configuration reads that secret before the composition, so the
 * file holds what the operator reads, and the unit test of
 * `startFailureMessage` holds the rule of both catches of the start.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { createDisposableDatabase } from './support/database.ts';

/** The entry point that a deployment runs. */
const entryPoint = resolve(
  import.meta.dirname,
  '../../apps/server/src/main.ts',
);

/** The exit of one process and everything that it wrote. */
type Finished = {
  readonly code: number | null;
  readonly output: string;
};

/** Runs the entry point to its end with one environment. */
async function runToEnd(
  environment: Readonly<Record<string, string>>,
): Promise<Finished> {
  return await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [entryPoint], {
      env: { PATH: process.env['PATH'] ?? '', ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => chunks.push(chunk));
    child.stderr.on('data', (chunk: string) => chunks.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => accept({ code, output: chunks.join('') }));
  });
}

const database = await createDisposableDatabase();
const directory = await mkdtemp(join(tmpdir(), 'notesapp-start-refusal-'));

await test('an operator secret that is too short stops the start and names its variable', async () => {
  const secret = 'too-short-operator-secret';
  const tokenFile = join(directory, 'operator_token');
  await writeFile(tokenFile, `${secret}\n`);
  const result = await runToEnd({
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_HOST: '127.0.0.1',
    NOTESAPP_PORT: '1',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: directory,
    NOTESAPP_AUTH_SECRET: 'start-refusal-test-secret-0123456789ab',
    NOTESAPP_LOG_LEVEL: 'silent',
    NOTESAPP_MAX_BODY_BYTES: '1048576',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
    NOTESAPP_OPERATOR_TOKEN_FILE: tokenFile,
  });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /notesapp: configuration error:/);
  assert.match(result.output, /NOTESAPP_OPERATOR_TOKEN_FILE/);
  assert.doesNotMatch(
    result.output,
    /could not start/,
    'the general sentence does not hide the setting',
  );
  assert.doesNotMatch(result.output, /listening on/);
  assert.equal(
    result.output.includes(secret),
    false,
    'the message never repeats the secret',
  );
});

await rm(directory, { recursive: true, force: true });
await database.destroy();
