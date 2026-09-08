/**
 * Integration tests for deployment operations, health/readiness probes,
 * write-pause coordination, metrics, host encryption checks, and backup/restore.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import {
  createAppWithHandlers,
  createAttachmentCleanup,
  createHandlers,
  createSyncCleanup,
  databaseProbe,
  loadProtectedEnvironment,
  loadServerConfig,
  MetricsCollector,
  migrationProbe,
  redactAccessUrl,
  redactUrl,
  storageProbe,
  WritePauseCoordinator,
  type ReadinessProbe,
} from '@notesapp/server';
import {
  createDisposableDatabase,
  type TestDatabase,
} from './support/database.ts';
import {
  anonymousIdentity,
  completeTestHandlers,
  stubProtocol,
  testEnvironment,
} from './support/server.ts';

await test('liveness and readiness root aliases report status correctly', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'notesapp-ops-health-'));
  try {
    const config = loadServerConfig(testEnvironment(tempDir));
    const app = await createAppWithHandlers(config, {
      handlers: completeTestHandlers(createHandlers(config)),
      identity: anonymousIdentity,
      protocols: [stubProtocol],
      webDist: null,
    });

    // Root /health alias
    const healthRoot = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(healthRoot.statusCode, 200);
    assert.deepEqual(JSON.parse(healthRoot.body), { status: 'ok' });

    // Contract /api/health path
    const healthApi = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(healthApi.statusCode, 200);
    assert.deepEqual(JSON.parse(healthApi.body), { status: 'ok' });

    // Root /ready alias
    const readyRoot = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(readyRoot.statusCode, 200);
    const readyBody = JSON.parse(readyRoot.body) as { status: string };
    assert.equal(readyBody.status, 'ok');

    await app.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('readiness reports degraded when a probe fails', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'notesapp-ops-ready-'));
  try {
    const config = loadServerConfig(testEnvironment(tempDir));

    const failingProbe: ReadinessProbe = () =>
      Promise.resolve({
        name: 'database',
        status: 'degraded',
        detail: 'Simulated connection failure',
      });

    const handlers = createHandlers(config, [failingProbe]);
    const app = await createAppWithHandlers(config, {
      handlers: completeTestHandlers(handlers),
      identity: anonymousIdentity,
      protocols: [stubProtocol],
      webDist: null,
    });

    const res = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body) as { code: string; status: number };
    assert.equal(body.code, 'not_ready');
    assert.equal(body.status, 503);

    await app.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('storage probe detects missing or unwritable directory', async () => {
  const missingDir = join(tmpdir(), `notesapp-nonexistent-${Date.now()}`);
  const probe = storageProbe(missingDir);
  const result = await probe();
  assert.equal(result.name, 'storage');
  assert.equal(result.status, 'degraded');
});

await test('database probe detects invalid connection URL', async () => {
  const badUrl = 'postgres://invalid:invalid@127.0.0.1:1/invalid';
  const probe = databaseProbe(badUrl);
  const result = await probe();
  assert.equal(result.name, 'database');
  assert.equal(result.status, 'degraded');
});

await test('protected configuration files load without exposing their values', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'notesapp-ops-config-'));
  try {
    const secretFile = join(tempDir, 'auth-secret');
    writeFileSync(secretFile, 'a-protected-secret-with-at-least-32-characters');
    const loaded = await loadProtectedEnvironment({
      NOTESAPP_AUTH_SECRET_FILE: secretFile,
    });
    assert.equal(
      loaded['NOTESAPP_AUTH_SECRET'],
      'a-protected-secret-with-at-least-32-characters',
    );
    await assert.rejects(
      loadProtectedEnvironment({
        NOTESAPP_AUTH_SECRET: 'direct-value',
        NOTESAPP_AUTH_SECRET_FILE: secretFile,
      }),
      /set either NOTESAPP_AUTH_SECRET or NOTESAPP_AUTH_SECRET_FILE/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('write-pause coordinator drains active writers and blocks mutations with 503', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'notesapp-ops-pause-'));
  try {
    const config = loadServerConfig(testEnvironment(tempDir));
    const writePause = new WritePauseCoordinator(tempDir);
    const app = await createAppWithHandlers(config, {
      handlers: completeTestHandlers(createHandlers(config)),
      identity: anonymousIdentity,
      protocols: [stubProtocol],
      writePause,
      webDist: null,
    });

    // Initially unpaused
    assert.equal(writePause.isPaused(), false);
    const releaseWrite = writePause.beginWrite();
    assert.ok(releaseWrite !== null);
    assert.equal(writePause.getActiveWriters(), 1);
    assert.equal(readdirSync(join(tempDir, 'active-writes')).length, 1);

    // Release write
    releaseWrite();
    assert.equal(writePause.getActiveWriters(), 0);
    assert.equal(readdirSync(join(tempDir, 'active-writes')).length, 0);

    // Request pause
    await writePause.pause('Backup in progress');
    assert.equal(writePause.isPaused(), true);
    assert.ok(existsSync(join(tempDir, 'write-pause.json')));

    // New writes cannot begin
    assert.equal(writePause.beginWrite(), null);

    // Mutating HTTP requests are rejected with 503 write_paused
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(postRes.statusCode, 503);
    assert.equal(postRes.headers['retry-after'], '30');
    const problem = JSON.parse(postRes.body) as {
      code: string;
      status: number;
    };
    assert.equal(problem.code, 'write_paused');
    assert.equal(problem.status, 503);

    // GET requests continue to succeed
    const getRes = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(getRes.statusCode, 200);

    // Background jobs halt when write is paused
    const cleanupRan = await createSyncCleanup(
      {
        cleanupSync: () =>
          Promise.resolve({ expiredSnapshots: 5, oldChanges: 10 }),
      },
      writePause,
    )();
    assert.deepEqual(cleanupRan, { expiredSnapshots: 0, oldChanges: 0 });

    const attachmentCleanupRan = await createAttachmentCleanup(
      {
        reclaimAttachments: () => Promise.resolve(10),
      } as unknown as Parameters<typeof createAttachmentCleanup>[0],
      writePause,
    )();
    assert.equal(attachmentCleanupRan, 0);

    // Resuming writes clears the pause
    await writePause.resume();
    assert.equal(writePause.isPaused(), false);

    await app.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('observability metrics and URL redaction', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'notesapp-ops-metrics-'));
  try {
    const config = loadServerConfig(testEnvironment(tempDir));
    const metrics = new MetricsCollector(tempDir, () => Promise.resolve(4096));

    const app = await createAppWithHandlers(config, {
      handlers: completeTestHandlers(createHandlers(config)),
      identity: anonymousIdentity,
      protocols: [stubProtocol],
      metrics,
      webDist: null,
    });

    // Test URL redaction
    assert.equal(redactUrl('/s/secretToken12345'), '/s/[redacted]');
    assert.equal(
      redactUrl('/s/secretToken12345/attachments/revision789'),
      '/s/[redacted]',
    );
    assert.equal(
      redactUrl('/api/workspaces/123/search?q=classifiedQuery'),
      '/api/workspaces/123/search?[redacted]',
    );
    assert.equal(
      redactAccessUrl('/api/workspaces/123/search?q=classifiedQuery'),
      '/api/workspaces/123/search?[redacted]',
    );

    // Make requests to trigger metrics
    await app.inject({ method: 'GET', url: '/health' });
    metrics.recordSaveFailure();
    metrics.recordAuthFailure();

    // Verify Prometheus text exposition
    const promRes = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(promRes.statusCode, 200);
    assert.match(promRes.headers['content-type'] ?? '', /text\/plain/);
    assert.ok(promRes.body.includes('notesapp_save_failures_total 1'));
    assert.ok(promRes.body.includes('notesapp_auth_failures_total 1'));
    assert.ok(promRes.body.includes('notesapp_storage_usage_bytes 4096'));

    // Verify JSON metrics
    const jsonRes = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { accept: 'application/json' },
    });
    assert.equal(jsonRes.statusCode, 200);
    const jsonBody = JSON.parse(jsonRes.body) as {
      saveFailures: number;
      authFailures: number;
      storageUsageBytes: number;
    };
    assert.equal(jsonBody.saveFailures, 1);
    assert.equal(jsonBody.authFailures, 1);
    assert.equal(jsonBody.storageUsageBytes, 4096);

    await app.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('host encryption verification script', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'notesapp-ops-encrypt-'));
  try {
    const scriptPath = join(process.cwd(), 'tools/ops/check-host.sh');

    // Without encryption marker, non-encrypted filesystem fails
    assert.throws(
      () => {
        execFileSync(
          scriptPath,
          [
            '--storage-dir',
            tempDir,
            '--db-dir',
            tempDir,
            '--wal-dir',
            tempDir,
            '--backup-dir',
            tempDir,
            '--temp-dir',
            tempDir,
            '--crash-dir',
            tempDir,
          ],
          { stdio: 'pipe' },
        );
      },
      (err: unknown) => err !== null,
    );

    // With simulated encryption marker and --allow-simulated, check passes
    writeFileSync(join(tempDir, '.encrypted_marker'), 'test');
    const output = execFileSync(
      scriptPath,
      [
        '--storage-dir',
        tempDir,
        '--db-dir',
        tempDir,
        '--wal-dir',
        tempDir,
        '--backup-dir',
        tempDir,
        '--temp-dir',
        tempDir,
        '--crash-dir',
        tempDir,
        '--allow-simulated',
      ],
      { encoding: 'utf8' },
    );
    assert.ok(output.includes('Host encryption check PASSED'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('coordinated backup and verified restoration cycle', async () => {
  const sourceStorage = await mkdtemp(join(tmpdir(), 'notesapp-backup-src-'));
  const targetStorage = await mkdtemp(join(tmpdir(), 'notesapp-backup-tgt-'));
  const backupRoot = await mkdtemp(join(tmpdir(), 'notesapp-backups-'));
  const configRoot = await mkdtemp(join(tmpdir(), 'notesapp-backup-config-'));

  let sourceDb: TestDatabase | null = null;
  let targetDb: TestDatabase | null = null;

  try {
    sourceDb = await createDisposableDatabase();
    targetDb = await createDisposableDatabase();
    const schemaStatus = await migrationProbe(sourceDb.runtimeUrl)();
    assert.equal(schemaStatus.status, 'ok');

    // Create attachment file and database record in source
    const content = Buffer.from('dummy attachment content');
    const digest = createHash('sha256').update(content).digest('hex');
    const workspaceId = randomUUID();
    const relFolder = join('workspaces', workspaceId, 'attachments');
    mkdirSync(join(sourceStorage, relFolder), { recursive: true });
    writeFileSync(join(sourceStorage, relFolder, digest), content);

    const objectId = randomUUID();
    const pgClient = new pg.Client({ connectionString: sourceDb.migrationUrl });
    await pgClient.connect();
    await pgClient.query(
      'INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, now())',
      [workspaceId, 'Backup Test Workspace'],
    );
    await pgClient.query(
      `INSERT INTO attachment_objects (workspace_id, id, digest, size, media_type, state)
       VALUES ($1, $2, $3, $4, 'text/plain', 'finalized')`,
      [workspaceId, objectId, digest, content.length],
    );
    await pgClient.query(
      `INSERT INTO contents (workspace_id, digest, kind, size, object_id)
       VALUES ($1, $2, 'attachment', $3, $4)`,
      [workspaceId, digest, content.length, objectId],
    );
    await pgClient.end();

    const databaseUrlFile = join(configRoot, 'database-url');
    const targetDatabaseUrlFile = join(configRoot, 'target-database-url');
    const keyFile = join(configRoot, 'backup-key');
    const installationIdFile = join(configRoot, 'installation-id');
    writeFileSync(databaseUrlFile, sourceDb.migrationUrl);
    writeFileSync(targetDatabaseUrlFile, targetDb.migrationUrl);
    writeFileSync(
      keyFile,
      'test-backup-key-with-more-than-thirty-two-characters',
    );
    writeFileSync(installationIdFile, randomUUID());
    for (const file of [
      databaseUrlFile,
      targetDatabaseUrlFile,
      keyFile,
      installationIdFile,
    ])
      chmodSync(file, 0o600);
    const postgresContainer = execFileSync(
      'docker',
      [
        'ps',
        '--filter',
        'publish=55432',
        '--filter',
        'label=com.docker.compose.service=postgres',
        '--format',
        '{{.ID}}',
      ],
      { encoding: 'utf8' },
    ).trim();
    assert.notEqual(postgresContainer, '');
    assert.equal(postgresContainer.includes('\n'), false);

    // Run backup script
    const backupScript = join(process.cwd(), 'tools/ops/backup.sh');
    const existingPause = join(sourceStorage, 'write-pause.json');
    writeFileSync(existingPause, '{"reason":"operator maintenance"}', {
      mode: 0o600,
    });
    assert.throws(() =>
      execFileSync(
        backupScript,
        [
          '--storage-root',
          sourceStorage,
          '--backup-root',
          backupRoot,
          '--database-url-file',
          databaseUrlFile,
          '--key-file',
          keyFile,
          '--installation-id-file',
          installationIdFile,
          '--postgres-container',
          postgresContainer,
        ],
        { encoding: 'utf8' },
      ),
    );
    assert.equal(
      readFileSync(existingPause, 'utf8'),
      '{"reason":"operator maintenance"}',
    );
    unlinkSync(existingPause);

    const backupOutput = execFileSync(
      backupScript,
      [
        '--storage-root',
        sourceStorage,
        '--backup-root',
        backupRoot,
        '--database-url-file',
        databaseUrlFile,
        '--key-file',
        keyFile,
        '--installation-id-file',
        installationIdFile,
        '--postgres-container',
        postgresContainer,
      ],
      { encoding: 'utf8' },
    );
    assert.ok(backupOutput.includes('Backup completed successfully'));

    const backupFiles = readdirSync(backupRoot);
    assert.equal(backupFiles.length, 1);
    const backupName = backupFiles.at(0);
    assert.ok(backupName !== undefined);
    const backupFile = join(backupRoot, backupName);
    assert.match(backupFile, /[.]tar[.]gpg$/);

    // Verify backup using verify script
    const verifyScript = join(process.cwd(), 'tools/ops/verify-backup.sh');
    const verifyOutput = execFileSync(
      verifyScript,
      [
        '--backup-file',
        backupFile,
        '--key-file',
        keyFile,
        '--installation-id-file',
        installationIdFile,
      ],
      { encoding: 'utf8' },
    );
    assert.ok(verifyOutput.includes('Verification passed'));

    // Run restore into target environment
    const restoreScript = join(process.cwd(), 'tools/ops/restore.sh');
    const restoreOutput = execFileSync(
      restoreScript,
      [
        '--backup-file',
        backupFile,
        '--storage-root',
        targetStorage,
        '--database-url-file',
        targetDatabaseUrlFile,
        '--key-file',
        keyFile,
        '--installation-id-file',
        installationIdFile,
        '--postgres-container',
        postgresContainer,
      ],
      { encoding: 'utf8' },
    );
    assert.ok(restoreOutput.includes('Restoration completed successfully'));

    // Verify that the restored storage root contains the attachment
    const restoredFile = join(targetStorage, relFolder, digest);
    assert.ok(existsSync(restoredFile));
  } finally {
    if (sourceDb) await sourceDb.destroy();
    if (targetDb) await targetDb.destroy();
    await rm(sourceStorage, { recursive: true, force: true });
    await rm(targetStorage, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});
