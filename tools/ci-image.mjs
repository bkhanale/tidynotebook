import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageCache } from './ci-cache.mjs';

const temporary = process.env.RUNNER_TEMP;
const environmentPath = process.env.GITHUB_ENV;
if (!environmentPath) throw new Error('GITHUB_ENV is required.');
if (!temporary) throw new Error('RUNNER_TEMP is required.');
const secrets = join(temporary, 'notesapp-secrets');
mkdirSync(secrets, { recursive: true, mode: 0o700 });
for (const name of [
  'postgres_password',
  'migration_database_url',
  'runtime_database_password',
  'auth_database_password',
  'runtime_database_url',
  'auth_database_url',
  'auth_secret',
])
  writeFileSync(join(secrets, name), 'ci-placeholder', { mode: 0o600 });
const cache = imageCache('amd64');
for (const cold of [false, true])
  writeFileSync(
    join(temporary, cold ? 'ci-image-cold.yaml' : 'ci-image.yaml'),
    JSON.stringify({
      services: {
        app: {
          build: {
            platforms: ['linux/amd64'],
            cache_from: cold ? [] : cache.from,
            cache_to: cold ? [] : cache.to,
          },
        },
      },
    }),
  );
appendFileSync(
  environmentPath,
  `NOTESAPP_SECRETS_DIR=${secrets}\nNOTESAPP_DATABASE_DIR=${temporary}/notesapp-postgres\nNOTESAPP_STORAGE_DIR=${temporary}/notesapp-storage\n`,
);
