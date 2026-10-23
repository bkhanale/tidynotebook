# Upgrade

This page is for the person who runs the server. It shows how to move an
installation to a new release, and how to go back.

A new release can change the database. A change moves forward only. So make a
verified backup before you start. An upgrade with no verified backup has no way
back.

## 1. Make and verify a backup

Make a backup and verify it, as [Backup and restore](backup-and-restore.md)
states. Keep the archive.

## 2. Install the new release

Run these commands in the installation's clone folder. Replace `vX.Y.Z`
with the new release tag. Keep the same tag for the checkout and image selection.

1. Fetch the new tag and check it out:

   ```bash
   git fetch --depth 1 origin tag vX.Y.Z
   git checkout vX.Y.Z
   ```

   The checkout supplies the Compose files, operator scripts, and migrations
   that match the new image. Do not select an image from the old checkout.

2. Complete [Select the stable image](published-images.md#select-the-stable-image).
   Its commands read the checked-out tag, check the public manifest, and write
   the new image digest to `.env`. Stop if any check fails. Do not edit the
   digest by hand.

3. On an ARM host, complete the applicable
   [platform steps](published-images.md#supported-platforms) in this shell.
   Download the selected image and apply the release settings:

   ```bash
   docker compose pull app
   docker compose up -d --no-build --wait
   docker compose ps
   ```

   Compose replaces the application container and waits for it to be healthy.
   It does not build source. If startup fails, read the application log:

   ```bash
   docker compose logs app
   ```

## What happens at the start

The application container applies the database migrations before it serves.
The application does not report ready until the migrations are complete.

A migration moves forward only. If one fails, the container exits and the
restart policy repeats the attempt. The application stays not ready while that
happens. Read the log of the application, fix the cause, and the next attempt
completes.

## Going back

There is no downward migration. To go back to the old release:

1. Restore the verified backup from before the upgrade into an empty target.
   See [Backup and restore](backup-and-restore.md#restore).
2. Check out the old release tag, or set the old `NOTESAPP_IMAGE` line, and
   start the application against the restored data.

Do not copy a database without its attachments. Do not copy attachments
without the database from the same moment. The two parts are one backup.

## Contributor source builds

Contributors who build from source first check out the new tag as above.
Use a separate local image name for both the build and startup commands:

```bash
NOTESAPP_IMAGE=notesapp-source:local docker compose build
NOTESAPP_IMAGE=notesapp-source:local docker compose up -d --no-build --wait
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the contributor checks.
