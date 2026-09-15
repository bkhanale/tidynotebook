/**
 * Integration tests for deployment operations, health and readiness probes,
 * request log redaction, host encryption checks, and backup and restore.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import {
  createAppWithHandlers,
  createHandlers,
  databaseProbe,
  loadProtectedEnvironment,
  loadServerConfig,
  migrationProbe,
  redactUrl,
  storageProbe,
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
    const readyBody: unknown = JSON.parse(readyRoot.body);
    assert.ok(
      typeof readyBody === 'object' && readyBody !== null,
      'the readiness answer is a record',
    );
    assert.ok('status' in readyBody);
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
    const body: unknown = JSON.parse(res.body);
    assert.ok(
      typeof body === 'object' && body !== null,
      'the readiness problem is a record',
    );
    assert.ok('code' in body && 'status' in body);
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

await test('the request log redacts query strings', () => {
  assert.equal(
    redactUrl('/api/workspaces/123/search?q=classifiedQuery'),
    '/api/workspaces/123/search?[redacted]',
  );
  assert.equal(redactUrl('/api/health'), '/api/health');
});

await test('no metrics route is served', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'notesapp-ops-metrics-'));
  try {
    const config = loadServerConfig(testEnvironment(tempDir));
    const app = await createAppWithHandlers(config, {
      handlers: completeTestHandlers(createHandlers(config)),
      identity: anonymousIdentity,
      protocols: [stubProtocol],
      webDist: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { host: '127.0.0.1' },
    });
    assert.equal(res.statusCode, 404);

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

await test('backup and restore round-trip a note with its history and attachments', async () => {
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

    // One real note with two saved versions, so the cycle covers note text and
    // its history and not only an attachment file.
    const accountId = randomUUID();
    const fileId = randomUUID();
    const notePath = 'notes/backup-round-trip.md';
    const bodies = [
      '# First save\n\nOriginal text.\n',
      '# Second save\n\nEdited text.\n',
    ];
    const noteDigests = bodies.map((body) =>
      createHash('sha256').update(body, 'utf8').digest('hex'),
    );
    const revisionIds = [randomUUID(), randomUUID()];
    await pgClient.query('INSERT INTO accounts (id) VALUES ($1)', [accountId]);
    await pgClient.query(
      `INSERT INTO memberships (workspace_id, account_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, accountId],
    );
    await pgClient.query(
      `INSERT INTO files (workspace_id, id, path, kind, deleted)
       VALUES ($1, $2, $3, 'note', false)`,
      [workspaceId, fileId, notePath],
    );
    for (const [index, body] of bodies.entries()) {
      const changesetId = randomUUID();
      await pgClient.query(
        `INSERT INTO contents (workspace_id, digest, kind, size, markdown)
         VALUES ($1, $2, 'markdown', $3, $4)`,
        [workspaceId, noteDigests[index], Buffer.byteLength(body), body],
      );
      await pgClient.query(
        `INSERT INTO changesets (workspace_id, id, mutation_id, actor_account_id, device_id, request_digest, cursor)
         VALUES ($1, $2, $3, $4, 'backup-test-device', $5, $6)`,
        [
          workspaceId,
          changesetId,
          randomUUID(),
          accountId,
          noteDigests[index],
          index + 1,
        ],
      );
      await pgClient.query(
        `INSERT INTO revisions (workspace_id, id, file_id, content_digest, path, deleted, changeset_id, actor_account_id, client_time)
         VALUES ($1, $2, $3, $4, $5, false, $6, $7, now())`,
        [
          workspaceId,
          revisionIds[index],
          fileId,
          noteDigests[index],
          notePath,
          changesetId,
          accountId,
        ],
      );
    }
    await pgClient.query(
      `INSERT INTO revision_parents (workspace_id, child_id, parent_id, ordinal)
       VALUES ($1, $2, $3, 0)`,
      [workspaceId, revisionIds[1], revisionIds[0]],
    );
    await pgClient.query(
      'UPDATE files SET head_revision_id = $3 WHERE workspace_id = $1 AND id = $2',
      [workspaceId, fileId, revisionIds[1]],
    );
    await pgClient.query(
      'INSERT INTO live_paths (workspace_id, file_id, path) VALUES ($1, $2, $3)',
      [workspaceId, fileId, notePath],
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

    // The note and its two saved versions survive the cycle with their text.
    const restoredClient = new pg.Client({
      connectionString: targetDb.migrationUrl,
    });
    await restoredClient.connect();
    try {
      const counts = await restoredClient.query<{
        files: string;
        revisions: string;
        parents: string;
      }>(
        `SELECT (SELECT count(*) FROM files WHERE workspace_id = $1)::text AS files,
                (SELECT count(*) FROM revisions WHERE workspace_id = $1)::text AS revisions,
                (SELECT count(*) FROM revision_parents WHERE workspace_id = $1)::text AS parents`,
        [workspaceId],
      );
      assert.deepEqual(counts.rows.at(0), {
        files: '1',
        revisions: '2',
        parents: '1',
      });

      const history = await restoredClient.query<{
        markdown: string;
        path: string;
        is_head: boolean;
      }>(
        `SELECT c.markdown, r.path, (f.head_revision_id = r.id) AS is_head
         FROM revisions r
         JOIN contents c
           ON c.workspace_id = r.workspace_id AND c.digest = r.content_digest
         JOIN files f
           ON f.workspace_id = r.workspace_id AND f.id = r.file_id
         WHERE r.workspace_id = $1 AND r.file_id = $2
         ORDER BY c.markdown`,
        [workspaceId, fileId],
      );
      assert.deepEqual(
        history.rows.map((row) => row.markdown),
        bodies,
      );
      assert.deepEqual(
        history.rows.map((row) => row.path),
        [notePath, notePath],
      );
      assert.deepEqual(
        history.rows.map((row) => row.is_head),
        [false, true],
      );

      const parent = await restoredClient.query<{ parent_id: string }>(
        'SELECT parent_id FROM revision_parents WHERE workspace_id = $1 AND child_id = $2',
        [workspaceId, revisionIds[1]],
      );
      assert.equal(parent.rows.at(0)?.parent_id, revisionIds[0]);
    } finally {
      await restoredClient.end();
    }
  } finally {
    if (sourceDb) await sourceDb.destroy();
    if (targetDb) await targetDb.destroy();
    await rm(sourceStorage, { recursive: true, force: true });
    await rm(targetStorage, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});
