/** Read and restore backup attachments through the application storage adapters. */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { record } from './workspace.mjs';

class BackupObjectError extends Error {}

/** Read one protected credential without sending its value to the terminal.
 * @param {string} file */
function protectedValue(file) {
  const info = statSync(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new BackupObjectError(
      'A storage settings or credential file is not protected. Use mode 0600.',
    );
  const value = readFileSync(file, 'utf8').trim();
  if (!value)
    throw new BackupObjectError(
      'A storage settings or credential file is empty.',
    );
  return value;
}

/** @param {Record<string, unknown>} value @param {string} name */
function textSetting(value, name) {
  const text = value[name];
  if (typeof text !== 'string' || !text.trim())
    throw new BackupObjectError('The object storage settings are incomplete.');
  return text;
}

/** Validate transport before any storage client or credential is opened.
 * @param {unknown} value
 * @returns {string | null} */
export function backupStorageEndpoint(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string')
    throw new BackupObjectError('The object storage endpoint is invalid.');
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new BackupObjectError('The object storage endpoint is invalid.');
  }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(
    endpoint.hostname,
  );
  if (
    endpoint.protocol !== 'https:' &&
    !(endpoint.protocol === 'http:' && loopback)
  )
    throw new BackupObjectError(
      'Object storage needs HTTPS. HTTP is permitted only on loopback addresses.',
    );
  return endpoint.href;
}

/** @param {string} root @param {string | undefined} configFile */
async function openStore(root, configFile) {
  if (!configFile) {
    const { openFileObjectStore } =
      await import('../packages/storage-server/src/object-store/file-store.ts');
    return {
      store: openFileObjectStore(root),
      assertEmpty: async () => undefined,
    };
  }
  const settings = record(JSON.parse(protectedValue(configFile)));
  const endpoint = backupStorageEndpoint(settings.endpoint);
  const config = {
    bucket: textSetting(settings, 'bucket'),
    region: textSetting(settings, 'region'),
    endpoint: endpoint ?? null,
    accessKeyId: protectedValue(textSetting(settings, 'accessKeyIdFile')),
    secretAccessKey: protectedValue(
      textSetting(settings, 'secretAccessKeyFile'),
    ),
  };
  const { openS3ObjectStore, defaultS3Timeouts } =
    await import('../packages/storage-server/src/object-store/s3-store.ts');
  return {
    store: openS3ObjectStore(config, defaultS3Timeouts),
    async assertEmpty() {
      const { S3Client, ListObjectsV2Command } =
        await import('@aws-sdk/client-s3');
      const client = new S3Client({
        region: config.region,
        ...(config.endpoint === null
          ? {}
          : { endpoint: config.endpoint, forcePathStyle: true }),
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        maxAttempts: 1,
        requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
      });
      try {
        const found = await client.send(
          new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }),
        );
        if ((found.Contents?.length ?? 0) > 0)
          throw new BackupObjectError(
            'The target object storage bucket is not empty.',
          );
      } finally {
        client.destroy();
      }
    },
  };
}

/** @param {string} rowsPath */
function referencedObjects(rowsPath) {
  return readFileSync(rowsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [workspaceId = '', digest = '', sizeText = ''] = row.split('\t');
      const size = Number(sizeText);
      if (
        !/^[0-9a-f-]{36}$/.test(workspaceId) ||
        !/^[0-9a-f]{64}$/.test(digest) ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        sizeText === ''
      )
        throw new BackupObjectError(
          'The database returned an invalid attachment identity.',
        );
      return {
        path: `workspaces/${workspaceId}/attachments/${digest}`,
        sha256: digest,
        size,
      };
    });
}

/** @param {import('../packages/storage-server/src/object-store/port.ts').ObjectStore} store
 * @param {{path: string, sha256: string, size: number}} object */
async function readChecked(store, object) {
  const stream = await store.read(object.path);
  if (stream === null)
    throw new BackupObjectError(
      'A referenced attachment is missing from object storage.',
    );
  const bytes = await buffer(stream);
  if (
    bytes.length !== object.size ||
    createHash('sha256').update(bytes).digest('hex') !== object.sha256
  )
    throw new BackupObjectError(
      'An attachment does not match its database digest or size.',
    );
  return bytes;
}

/** @param {NodeJS.ProcessEnv} env @param {string} name */
function required(env, name) {
  const value = env[name];
  if (!value)
    throw new BackupObjectError(
      'The backup storage command is missing a required setting.',
    );
  return value;
}

/** @param {string} mode @param {NodeJS.ProcessEnv} env */
export async function runBackupObjects(mode, env) {
  const storage = await openStore(
    required(env, 'NOTESAPP_STORAGE_ROOT'),
    env.NOTESAPP_OBJECT_STORE_CONFIG_FILE,
  );
  const { store } = storage;
  try {
    if (mode === 'empty') {
      await storage.assertEmpty();
      return;
    }
    const contentDir = required(env, 'NOTESAPP_CONTENT_DIR');
    if (mode === 'restore') {
      const manifest = record(
        JSON.parse(readFileSync(join(contentDir, 'manifest.json'), 'utf8')),
      );
      if (!Array.isArray(manifest.objects))
        throw new BackupObjectError('The backup manifest has no object list.');
      for (const entry of manifest.objects) {
        const object = record(entry);
        if (
          typeof object.path !== 'string' ||
          typeof object.size !== 'number' ||
          !/^workspaces\/[0-9a-f-]{36}\/attachments\/[0-9a-f]{64}$/.test(
            object.path,
          )
        )
          throw new BackupObjectError(
            'The backup manifest has an invalid object.',
          );
        await store.write(
          object.path,
          createReadStream(join(contentDir, 'storage', object.path)),
          object.size,
        );
      }
      return;
    }
    if (mode !== 'backup' && mode !== 'verify')
      throw new BackupObjectError('The backup storage command is invalid.');
    const objects = referencedObjects(required(env, 'NOTESAPP_ROWS_PATH'));
    for (const object of objects) {
      const bytes = await readChecked(store, object);
      if (mode === 'backup') {
        const target = join(contentDir, 'storage', object.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      }
    }
    if (mode === 'backup') {
      const database = readFileSync(join(contentDir, 'database.sql'));
      writeFileSync(
        join(contentDir, 'manifest.json'),
        JSON.stringify(
          {
            version: 1,
            createdAt: new Date().toISOString(),
            installationHash: required(env, 'NOTESAPP_INSTALLATION_HASH'),
            database: {
              file: 'database.sql',
              sha256: createHash('sha256').update(database).digest('hex'),
              size: database.length,
            },
            objects,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    store.close();
  }
}

if (import.meta.main) {
  try {
    await runBackupObjects(process.argv[2] ?? '', process.env);
  } catch (error) {
    process.stderr.write(
      `notesapp backup storage: ${error instanceof BackupObjectError ? error.message : 'The storage operation failed. Check the protected settings, credentials, permissions, and service availability.'}\n`,
    );
    process.exitCode = 1;
  }
}
