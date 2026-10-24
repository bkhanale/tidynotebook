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

await test('both backup clients ignore inherited endpoints and keep explicit endpoints', async (t) => {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const directory = mkdtempSync(join(tmpdir(), 'backup-inherited-endpoint-'));
  // Capture the method for an explicit Reflect.apply with each client receiver.
  const originalSend = Reflect.get(S3Client.prototype, 'send');
  /** @type {{protocol: string, hostname: string}[]} */
  const requests = [];
  t.mock.method(
    S3Client.prototype,
    'send',
    /** @this {import('@aws-sdk/client-s3').S3Client} @param {unknown[]} args @returns {Promise<unknown>} */
    function (...args) {
      t.mock.method(
        this.config.requestHandler,
        'handle',
        /** @param {{protocol: string, hostname: string}} request */
        async (request) => {
          requests.push({
            protocol: request.protocol,
            hostname: request.hostname,
          });
          throw new Error('intercepted backup transport');
        },
      );
      return Reflect.apply(originalSend, this, args);
    },
  );
  const names = [
    'AWS_ENDPOINT_URL',
    'AWS_ENDPOINT_URL_S3',
    'AWS_CONFIG_FILE',
    'AWS_PROFILE',
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    const awsConfig = join(directory, 'aws-config');
    writeFileSync(
      awsConfig,
      '[profile backup-test]\nendpoint_url = http://profile-endpoint.invalid\n',
    );
    process.env.AWS_CONFIG_FILE = awsConfig;
    process.env.AWS_PROFILE = 'backup-test';
    const settings = join(directory, 'settings.json');
    const key = join(directory, 'key');
    const secret = join(directory, 'secret');
    for (const file of [key, secret])
      writeFileSync(file, 'synthetic-test-credential', { mode: 0o600 });
    const rows = join(directory, 'rows');
    const workspace = 'b49fdde6-c617-4f46-9d94-b76427e27ef4';
    const digest = 'a'.repeat(64);
    writeFileSync(rows, `${workspace}\t${digest}\t3\n`);
    const env = {
      NOTESAPP_STORAGE_ROOT: directory,
      NOTESAPP_CONTENT_DIR: directory,
      NOTESAPP_ROWS_PATH: rows,
      NOTESAPP_OBJECT_STORE_CONFIG_FILE: settings,
    };
    for (const source of [
      'environment',
      'service-environment',
      'profile',
      'explicit',
    ]) {
      delete process.env.AWS_ENDPOINT_URL;
      delete process.env.AWS_ENDPOINT_URL_S3;
      if (source === 'environment')
        process.env.AWS_ENDPOINT_URL = 'http://environment-endpoint.invalid';
      if (source === 'service-environment')
        process.env.AWS_ENDPOINT_URL_S3 = 'http://service-endpoint.invalid';
      writeFileSync(
        settings,
        JSON.stringify({
          bucket: 'backup-test-bucket',
          region: 'us-east-1',
          ...(source === 'explicit'
            ? { endpoint: 'http://127.0.0.1:9500' }
            : {}),
          accessKeyIdFile: key,
          secretAccessKeyFile: secret,
        }),
        { mode: 0o600 },
      );
      for (const mode of ['backup', 'empty']) {
        process.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS = 'false';
        requests.length = 0;
        await assert.rejects(runBackupObjects(mode, env));
        assert.equal(requests.length, 1, `${source}: ${mode}`);
        assert.deepEqual(
          requests[0],
          source === 'explicit'
            ? { protocol: 'http:', hostname: '127.0.0.1' }
            : {
                protocol: 'https:',
                hostname: 'backup-test-bucket.s3.us-east-1.amazonaws.com',
              },
        );
      }
    }
  } finally {
    for (const [name, value] of previous)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    rmSync(directory, { recursive: true, force: true });
  }
});
