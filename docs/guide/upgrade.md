# Upgrade

This page is for the person who runs the server. It covers moving to a new
build and going back from one.

## Before you upgrade

Run a backup and verify it. See [Backup and restore](backup-and-restore.md). An
upgrade with no verified backup has no way back.

## Upgrade

Build the new image and start it, then wait for the readiness answer. The
application container applies the migrations before it serves, so a build whose
migrations have not run never reports ready.

A migration moves forward only. If one fails, the container exits and the
restart policy repeats the attempt, and the application stays unready while
that happens. Read the application container log, fix the cause, and the next
attempt completes.

## Going back

There is no downward migration. To go back to the prior build, restore the
verified pre-upgrade database and attachment set into an empty target, then
start the prior build against it.

Do not copy a database without its referenced attachments, and do not copy
attachments without the matching database snapshot. The two halves are one
backup. See [Backup and restore](backup-and-restore.md).
