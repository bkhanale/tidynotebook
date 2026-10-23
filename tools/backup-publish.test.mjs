/** Checks archive publication and recovery from an interrupted backup. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

for (const failVerification of [false, true]) {
  await test(`backup publishes only verified archives: verification ${failVerification ? 'fails' : 'passes'}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'backup-publication-'));
    try {
      const storage = join(directory, 'storage');
      const backups = join(directory, 'backups');
      const bin = join(directory, 'bin');
      for (const path of [storage, backups, bin]) mkdirSync(path);
      const stale = join(storage, '.backup-stage.interrupted');
      mkdirSync(stale);
      writeFileSync(join(stale, 'database.sql'), 'interrupted plaintext');
      // Similar names must not be removed by startup cleanup.
      const retained = join(storage, 'backup-stage.keep');
      mkdirSync(retained);
      const interruptedArchive = join(
        backups,
        'backup-20000101-000000Z.tar.gpg.partial',
      );
      writeFileSync(interruptedArchive, 'interrupted ciphertext');
      const protectedTarget = join(directory, 'protected-target');
      writeFileSync(protectedTarget, 'must remain unchanged');
      symlinkSync(protectedTarget, join(storage, '.backup.lock'));
      const settings = {
        'database-url': 'postgres://fixture:fixture@localhost/fixture',
        key: 'test-backup-passphrase-with-more-than-thirty-two-bytes',
        installation: 'b49fdde6-c617-4f46-9d94-b76427e27ef4',
      };
      for (const [name, value] of Object.entries(settings)) {
        const path = join(directory, name);
        writeFileSync(path, value);
        chmodSync(path, 0o600);
      }
      const commands = {
        psql: '#!/bin/sh\nexit 0\n',
        pg_dump: '#!/bin/sh\nprintf "SELECT 1;\\n"\n',
        gpg: `#!/bin/bash
set -euo pipefail
if [[ " $* " == *" --symmetric "* ]]; then
  output=''
  args=("$@")
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == --output ]]; then output="$2"; break; fi
    shift
  done
  [[ "$output" == *.partial ]]
  [[ ! -e "\${output%.partial}" ]]
  "$REAL_GPG" "\${args[@]}"
  [[ -s "$output" && ! -e "\${output%.partial}" ]]
  touch "$PUBLICATION_CHECKED"
  # A different source cannot clean an archive that this backup is writing.
  if "$BACKUP_SCRIPT" --storage-root "$SECOND_STORAGE" --backup-root "$BACKUPS_DIR" \
    --database-url-file "$FIXTURE_ROOT/database-url" --key-file "$FIXTURE_ROOT/key" \
    --installation-id-file "$FIXTURE_ROOT/installation" > "$FIXTURE_ROOT/concurrent.log" 2>&1; then
    exit 1
  fi
  grep -q 'another backup is using this backup root' "$FIXTURE_ROOT/concurrent.log"
  [[ -s "$output" ]]
  # The same source cannot clean this stage through a different destination.
  if "$BACKUP_SCRIPT" --storage-root "$SOURCE_STORAGE" --backup-root "$SECOND_BACKUPS" \
    --database-url-file "$FIXTURE_ROOT/database-url" --key-file "$FIXTURE_ROOT/key" \
    --installation-id-file "$FIXTURE_ROOT/installation" > "$FIXTURE_ROOT/concurrent.log" 2>&1; then
    exit 1
  fi
  grep -q 'another backup is using this storage root' "$FIXTURE_ROOT/concurrent.log"
  [[ -n "$(find "$SOURCE_STORAGE" -maxdepth 1 -type d -name '.backup-stage.*' -print -quit)" ]]
  touch "$CONCURRENCY_CHECKED"
else
  [[ -z "$(find "$BACKUPS_DIR" -maxdepth 1 -name 'backup-*.tar.gpg' -print -quit)" ]]
  touch "$VERIFICATION_CHECKED"
  [[ "$FAIL_VERIFICATION" != 1 ]] || exit 1
  exec "$REAL_GPG" "$@"
fi
`,
      };
      for (const [name, source] of Object.entries(commands)) {
        const path = join(bin, name);
        writeFileSync(path, source);
        chmodSync(path, 0o700);
      }
      const checked = join(directory, 'publication-checked');
      const verified = join(directory, 'verification-checked');
      const result = spawnSync(
        resolve('tools/ops/backup.sh'),
        [
          '--storage-root',
          storage,
          '--backup-root',
          backups,
          '--database-url-file',
          join(directory, 'database-url'),
          '--key-file',
          join(directory, 'key'),
          '--installation-id-file',
          join(directory, 'installation'),
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            REAL_GPG: execFileSync('which', ['gpg'], {
              encoding: 'utf8',
            }).trim(),
            FAIL_VERIFICATION: failVerification ? '1' : '0',
            PUBLICATION_CHECKED: checked,
            VERIFICATION_CHECKED: verified,
            BACKUPS_DIR: backups,
            SOURCE_STORAGE: storage,
            SECOND_STORAGE: join(directory, 'second-storage'),
            SECOND_BACKUPS: join(directory, 'second-backups'),
            BACKUP_SCRIPT: resolve('tools/ops/backup.sh'),
            FIXTURE_ROOT: directory,
            CONCURRENCY_CHECKED: join(directory, 'concurrency-checked'),
          },
        },
      );
      assert.equal(existsSync(checked), true, result.stderr);
      assert.equal(existsSync(verified), true, result.stderr);
      assert.equal(
        existsSync(join(directory, 'concurrency-checked')),
        true,
        result.stderr,
      );
      assert.equal(existsSync(interruptedArchive), false);
      assert.equal(
        readFileSync(protectedTarget, 'utf8'),
        'must remain unchanged',
      );
      assert.equal(existsSync(stale), false);
      assert.equal(existsSync(retained), true);
      assert.deepEqual(
        readdirSync(storage).filter((name) =>
          name.startsWith('.backup-stage.'),
        ),
        [],
      );
      const files = readdirSync(backups);
      if (failVerification) {
        assert.notEqual(result.status, 0);
        assert.deepEqual(files, []);
        assert.doesNotMatch(result.stdout, /Backup completed successfully/);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(files.length, 1);
        assert.match(files[0] ?? '', /^backup-.*\.tar\.gpg$/);
        assert.match(result.stdout, /Backup completed successfully/);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
