# Backup and restore

This page is for the person who runs the server. It shows how to make an
encrypted backup, check it, restore it, and what to do when a person loses a
password.

A backup is not proof that you can recover until a restore test passes. Test a
restore on a separate empty installation. Test it again after every change to
the storage layout.

## What you need

- The three files that the backup commands read. The script
  `tools/ops/create-secrets.sh` made them in your secrets folder, as
  [Self-hosting](self-hosting.md#create-the-secret-files) states:
  - `migration_database_url`: the address of the database. It serves as the
    database address file, because the backup script replaces the host name
    when it runs inside the database container.
  - `backup_key`: the passphrase that encrypts the backups.
  - `installation_id`: the random ID of this installation.
- A separate encrypted folder for the backups, for example
  `/mnt/separate-backups/notesapp`. It must not be inside the storage folder.
- Node.js 26.12.1, GnuPG and `tar` on the host. The scripts run them there.
  Under `sudo`, the `PATH` must hold `node`.
- For S3 backups, `jq`, pnpm 12.3.4, and the dependencies of the release checkout.
  Run `pnpm install --frozen-lockfile` as your normal user before the backup.
  No application source build is needed. The S3 adapter uses the installed
  AWS SDK.

If you made these files yourself, each one must have mode `0600`. The key file
holds at least 32 bytes of strong random data. The ID file holds one UUID.

Keep a copy of the files `backup_key` and `installation_id` away from this
host, as [Create the secret files](self-hosting.md#create-the-secret-files)
states. A restore needs both. Copy the files themselves: the backup checks the
exact bytes of `installation_id`, so a retyped ID can fail. The backup holds only a hash of the
installation ID, and a backup from a different installation is refused. If a
volume key or the backup key is lost, stop. Never make a new key and claim
that it can recover old data.

## Make a backup

Run these steps in the clone folder. The application writes while it runs. The
database part of a backup is consistent on its own. The attachment files never
change after they are written, so a save that lands during the backup is in the
archive in full or not at all. To make the two parts consistent with each
other, stop the application first. Keep every application instance and every
other writer stopped until the command finishes. Do not run object cleanup,
bucket migration, or retention deletion during this window.

1. Stop the application:

   ```bash
   docker compose stop app
   ```

2. Find the name of the database container. Run this command and read the
   `NAME` column of the `postgres` row:

   ```bash
   docker compose ps
   ```

   The name starts with the name of the clone folder. It is
   `notesapp-postgres-1` only when the folder is named `notesapp`.

3. Run the backup. Use `sudo`, because the secret files belong to user 10001
   and only that user and `root` can read them. Put the name of your database
   container after `--postgres-container`.

   ```bash
   sudo tools/ops/backup.sh \
     --storage-root /srv/notesapp/storage \
     --backup-root /mnt/separate-backups/notesapp \
     --database-url-file /etc/notesapp/secrets/migration_database_url \
     --key-file /etc/notesapp/secrets/backup_key \
     --installation-id-file /etc/notesapp/secrets/installation_id \
     --postgres-container notesapp-postgres-1
   ```

4. Start the application again:

   ```bash
   docker compose start app
   ```

A new file named `backup-` with the date and time appears in the backup
folder.

The options mean this:

- `--storage-root` is the folder `NOTESAPP_STORAGE_DIR` in `.env`.
- `--backup-root` is the folder for the encrypted archives.
- `--postgres-container` runs the database dump inside the database container.
  The database port is not published, so use this option with Compose. Leave
  it out only when `pg_dump` and `psql` on the host can reach the database.
  The database address never appears in the arguments of a host command.

The command does these things:

1. It lists the attachments that the database references.
2. It dumps the database.
3. It copies each referenced attachment, and checks its digest and size.
4. It writes a manifest with the digests of the database and of each file.
5. It encrypts the archive with GnuPG AES-256.
6. It decrypts the finished archive and checks it.
7. It keeps one backup for each of the newest seven UTC days, and one for each
   of the newest four ISO weeks.

### Back up an S3 installation

The archive includes the database and every finalized attachment that it
references. A separate bucket copy is not required. The archive format stays
at version 1, so existing filesystem archives remain readable. The updated
scripts can restore an archive to either storage type. The scripts shipped
in 0.19.0 do not support S3 backups. Use the operator scripts from the release
that includes this support.

Create the protected settings file:

```bash
sudo install -m 600 /dev/null /etc/notesapp/backup-s3.json
```

Use your bucket, region, endpoint, and the host paths of the credential files
from [Object storage](operations.md#object-storage). For AWS, set `endpoint`
to `null`. For R2 or MinIO, use an HTTPS endpoint that the backup host can
reach. A container-only host name does not work from the host.

```bash
jq -n \
  --arg bucket notesapp-images \
  --arg region us-east-1 \
  --arg access /etc/notesapp/secrets/s3_access_key_id \
  --arg secret /etc/notesapp/secrets/s3_secret_access_key \
  '{bucket: $bucket, region: $region, endpoint: null,
    accessKeyIdFile: $access, secretAccessKeyFile: $secret}' \
  | sudo tee /etc/notesapp/backup-s3.json > /dev/null
```

This example writes AWS settings. To use R2 or MinIO, edit `endpoint` in the
protected file with `sudoedit`, and set the bucket and region for that store.

Both credential files and the settings file must be nonempty regular files
with mode `0600`. The command reads them directly. Do not put credentials in
command arguments, shell history, or the settings JSON. The key needs read
and list access for backup. Restore also needs write access to its target.
Keep both buckets private.

Stop all writers as above. Then run:

```bash
sudo tools/ops/backup.sh \
  --storage-root /srv/notesapp/storage \
  --backup-root /mnt/separate-backups/notesapp \
  --database-url-file /etc/notesapp/secrets/migration_database_url \
  --key-file /etc/notesapp/secrets/backup_key \
  --installation-id-file /etc/notesapp/secrets/installation_id \
  --postgres-container notesapp-postgres-1 \
  --object-store-config-file /etc/notesapp/backup-s3.json
```

`--storage-root` remains the local work directory. It holds temporary backup
files on encrypted host storage. Attachment reads use the configured bucket,
not this directory. A missing image, a size or digest mismatch, or a store
failure stops the backup and removes its incomplete archive. Start the
application only after the backup command has finished. Use the same S3
settings option in scheduled backups.

## Schedule and watch the backups

Make at least one backup each day. Use the scheduler of your host. Copy the
encrypted archives to storage that is separate from the application host. Never
copy the backup key with the archives.

To see the newest archive, list the backup folder. The newest file is first:

```bash
ls -lt /mnt/separate-backups/notesapp
```

Raise an alert when the newest archive is older than one day. Use your own
monitoring for that.

## Verify a backup

This command decrypts one archive and checks its contents, and restores
nothing. Use a file name from the listing above.

```bash
sudo tools/ops/verify-backup.sh \
  --backup-file /mnt/separate-backups/notesapp/backup-20260906-120000Z.tar.gpg \
  --key-file /etc/notesapp/secrets/backup_key \
  --installation-id-file /etc/notesapp/secrets/installation_id
```

## Restore

A restore puts one backup into a new, empty installation. It never replaces
data that exists. The easiest way is a fresh installation that has started
once and has no notes.

The script refuses to run when the database already has a workspace or the
storage folder is not empty. With S3, it also refuses a bucket that contains
any object. Use a dedicated empty target bucket, a new empty database, and an
empty local storage folder. The database address file points at the new database. It is the
file `migration_database_url` of the new installation.

1. Make the new installation. Follow [Self-hosting](self-hosting.md) up to
   [Start the server](self-hosting.md#start-the-server). Do not create an
   account.
2. Stop the application, so that nothing writes while you restore:

   ```bash
   docker compose stop app
   ```

3. Replace the files `backup_key` and `installation_id` of the new
   installation with your saved copies. The new installation made files with
   other values, and they cannot open the old archives. Later backups of the
   restored installation must also use the saved values. Replace
   `/media/usb/notesapp-keys` with the folder of your copies. The second and
   the third command give the files to user 10001 with mode `0600`.

   ```bash
   sudo cp /media/usb/notesapp-keys/backup_key /media/usb/notesapp-keys/installation_id /etc/notesapp/secrets/
   sudo chown 10001:10001 /etc/notesapp/secrets/backup_key /etc/notesapp/secrets/installation_id
   sudo chmod 600 /etc/notesapp/secrets/backup_key /etc/notesapp/secrets/installation_id
   ```

4. Find the name of the new database container with `docker compose ps`, as in
   the backup steps.
5. Run the restore. The storage root is the empty storage folder of the new
   installation.

   ```bash
   sudo tools/ops/restore.sh \
     --backup-file /mnt/separate-backups/notesapp/backup-20260906-120000Z.tar.gpg \
     --storage-root /srv/notesapp/storage \
     --database-url-file /etc/notesapp/secrets/migration_database_url \
     --key-file /etc/notesapp/secrets/backup_key \
     --installation-id-file /etc/notesapp/secrets/installation_id \
     --postgres-container notesapp-postgres-1
   ```

   For an S3 target, prepare a new empty bucket and its credential files.
   Make a protected `/etc/notesapp/restore-s3.json` with the format above,
   using the target bucket and credentials. Run:

   ```bash
   sudo tools/ops/restore.sh \
     --backup-file /mnt/separate-backups/notesapp/backup-20260906-120000Z.tar.gpg \
     --storage-root /srv/notesapp/storage \
     --database-url-file /etc/notesapp/secrets/migration_database_url \
     --key-file /etc/notesapp/secrets/backup_key \
     --installation-id-file /etc/notesapp/secrets/installation_id \
     --postgres-container notesapp-postgres-1 \
     --object-store-config-file /etc/notesapp/restore-s3.json
   ```

   Set the application S3 settings to that same target bucket before startup.
   Use the same Compose S3 override as the original installation. A filesystem
   target needs no object storage option.

   The script verifies the archive before it changes data. It then loads the
   database and writes the attachments through the target adapter. At the end
   it reads each referenced attachment from the target and checks its digest
   and size against the restored database. A failed restore can leave partial
   data. Keep the application stopped. Remove only that failed recovery
   target, prepare a new empty target, and retry. Never clear a live bucket
   or database to make a restore pass.

6. Give the restored attachments to user 10001, the user inside the
   application container:

   ```bash
   sudo chown -R 10001:10001 /srv/notesapp/storage
   ```

7. Start the application:

   ```bash
   docker compose start app
   ```

8. Keep public access closed. Check that the server is ready. Sign in as the
   restored administrator. Open notes, their history, and attachments.
   For S3, confirm that the image loads from the target bucket while its local
   attachment path is absent.

   Keep the new target `auth_secret`. An old mail password sealed with the old
   secret cannot be opened with the new secret. In **Manage accounts**, open
   **Mail**, re-enter the SMTP password, select **Save**, and then select
   **Send a test message**.
   If mail comes from protected configuration files, check those target files
   and send a test message. Do not add the old auth secret to the backup.

   Check that **Forgot password** is available when mail is intended to work.
   Check the intended registration policy before you reopen access. A sealed
   report address from the old installation can also be unreadable with the
   new secret. Do not expect old sessions to survive the restore.

   Make and verify a new backup, then reopen access.

   ```bash
   curl http://127.0.0.1:3000/ready
   ```

## Two facts a restore depends on

- The row access rules of the database name the migration role by the name it
  had when the migration ran. A restore into a database where the schema owner
  has a different name leaves that owner without a rule. The database then
  hides every row from it. Restore under the same role name, or change every
  owner rule before you use the installation.
- The migration sets the runtime password with a DDL statement. An
  installation that logs DDL, or captures it with an audit extension, holds that
  password in its log. Change the runtime password after you turn on such
  logging. Keep the log under the same encryption rules as the data.

## Account recovery

A person who loses the account password has no way to get it back inside the
application. When the server can send mail, the sign-in page sends a reset link
after the person selects **Forgot password**. Otherwise set a new password from
the server. The command asks for it on the terminal and signs the account out
everywhere. See [Account commands](operations.md#account-commands).

```bash
docker compose exec app node server/dist/cli/recover-account.js --email person@example.com
```
