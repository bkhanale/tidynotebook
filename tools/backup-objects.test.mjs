/** Transport rules for backup and restore object-store clients. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupStorageEndpoint, runBackupObjects } from './backup-objects.mjs';

await test('backup uses the SDK default endpoint or an HTTPS endpoint', () => {
  assert.equal(backupStorageEndpoint(undefined), null);
  assert.equal(backupStorageEndpoint(null), null);
  assert.equal(
    backupStorageEndpoint('https://objects.example.test'),
    'https://objects.example.test/',
  );
});

await test('HTTP is accepted only on loopback addresses', () => {
  for (const host of ['127.0.0.1', '[::1]', 'localhost'])
    assert.equal(
      backupStorageEndpoint(`http://${host}:9500`),
      `http://${host}:9500/`,
    );
  for (const endpoint of [
    'http://objects.example.test',
    'http://192.168.1.10:9000',
    'http://localhost.example.test',
    'ftp://127.0.0.1',
    'file:///bucket',
  ])
    assert.throws(() => backupStorageEndpoint(endpoint), /HTTPS/);
});

await test('invalid endpoints fail without exposing endpoint values', () => {
  for (const endpoint of ['', 'not-a-url-private-value', 123, {}])
    assert.throws(() => backupStorageEndpoint(endpoint), {
      message: 'The object storage endpoint is invalid.',
    });
});

await test('all storage commands reject remote HTTP before reading credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'backup-endpoint-'));
  try {
    const settings = join(directory, 'settings.json');
    writeFileSync(
      settings,
      JSON.stringify({
        endpoint: 'http://objects.example.test',
        bucket: 'example',
        region: 'example',
        accessKeyIdFile: join(directory, 'absent-key'),
        secretAccessKeyFile: join(directory, 'absent-secret'),
      }),
      { mode: 0o600 },
    );
    for (const mode of ['backup', 'restore', 'empty'])
      await assert.rejects(
        runBackupObjects(mode, {
          NOTESAPP_STORAGE_ROOT: directory,
          NOTESAPP_OBJECT_STORE_CONFIG_FILE: settings,
        }),
        /HTTPS/,
      );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
