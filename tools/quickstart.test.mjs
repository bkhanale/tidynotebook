import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { record, root } from './workspace.mjs';

/** A Compose check must not take installation settings from the caller. */
function cleanEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(NOTESAPP_|POSTGRES_|COMPOSE_)/.test(name),
    ),
  );
}

/** Check the configuration only. Never start a container or remove data.
 * @param {string} directory */
function composeConfig(directory) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      join(directory, '.env'),
      '-f',
      join(root, 'docker-compose.yml'),
      'config',
      '--format',
      'json',
    ],
    { cwd: directory, env: cleanEnvironment(), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return record(JSON.parse(result.stdout));
}

/** The actual Compose output must keep all data inside the test directory.
 * @param {Record<string, unknown>} config @param {string} directory
 * @param {string} origin */
function checkIsolation(config, directory, origin) {
  const services = record(config.services);
  const app = record(services.app);
  const postgres = record(services.postgres);
  const environment = record(app.environment);
  assert.equal(environment.NOTESAPP_ORIGIN, origin);
  assert.ok(Array.isArray(app.ports));
  assert.equal(record(app.ports[0]).host_ip, '127.0.0.1');
  assert.ok(Array.isArray(app.volumes));
  const storage = app.volumes
    .map(record)
    .find((volume) => volume.target === '/var/lib/notesapp');
  assert.ok(storage && typeof storage.source === 'string');
  assert.ok(storage.source.startsWith(`${directory}/`));
  assert.ok(Array.isArray(postgres.volumes));
  const database = record(postgres.volumes[0]);
  assert.ok(typeof database.source === 'string');
  assert.ok(database.source.startsWith(`${directory}/`));
  const secrets = record(config.secrets);
  assert.equal(Object.keys(secrets).length, 7);
  for (const value of Object.values(secrets)) {
    const secret = record(value);
    assert.ok(typeof secret.file === 'string');
    assert.ok(secret.file.startsWith(`${directory}/`));
  }
}

await test('the quick start commands produce a valid isolated Compose configuration', async () => {
  await mkdir(join(root, '.tooling'), { recursive: true });
  const directory = await mkdtemp(join(root, '.tooling/quickstart-test-'));
  try {
    const guide = await readFile(
      join(root, 'docs/guide/quickstart.md'),
      'utf8',
    );
    const setup = guide.match(/```bash\n([\s\S]*?)\n```/)?.[1];
    assert.ok(setup, 'the quick start has no setup commands');
    // The test already has its own checkout directory. It runs the actual
    // configuration commands, without a network clone or a privileged write.
    const commands = setup
      .split('\n')
      .filter((line) => !/^(git clone\b|cd notesapp\b)/.test(line))
      .join('\n');
    execFileSync('bash', ['-eu', '-c', commands], {
      cwd: directory,
      env: cleanEnvironment(),
      stdio: 'pipe',
    });
    checkIsolation(
      composeConfig(directory),
      directory,
      'http://127.0.0.1:3000',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('the image CI job supplies every required Compose setting', async () => {
  await mkdir(join(root, '.tooling'), { recursive: true });
  const directory = await mkdtemp(join(root, '.tooling/compose-ci-test-'));
  try {
    const workflow = await readFile(
      join(root, '.github/workflows/ci.yml'),
      'utf8',
    );
    const image = workflow.slice(workflow.indexOf('\n  image:\n'));
    const env = image.match(/\n    env:\n((?:      [^\n]*\n)+)/)?.[1];
    assert.ok(env, 'the image job has no environment');
    // This block holds scalar environment settings. Expand the runner's
    // temporary directory to the test directory, then let Compose validate it.
    const settings = env
      .trim()
      .split('\n')
      .map((line) => {
        const match = line.trim().match(/^([A-Z_]+):\s*(.*)$/);
        assert.ok(match, `not a scalar environment setting: ${line}`);
        const raw = match[2];
        assert.ok(typeof raw === 'string');
        const value = raw
          .replace(/^'(.*)'$/, '$1')
          .replaceAll('${{ runner.temp }}', directory);
        return `${match[1]}=${value}`;
      });
    await writeFile(join(directory, '.env'), `${settings.join('\n')}\n`);
    checkIsolation(
      composeConfig(directory),
      directory,
      'https://notes.example.com',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
