# 0112. The owner account holds the storage quota

- Status: Accepted
- Date: 2026-09-26

## Context

Each workspace has its own quota record, with a default from
`packages/storage-server/src/provision.ts`, and an account can create
workspaces with no limit. One account can therefore fill the disk of every
other account. See
[design 015](../design/015-several-accounts-on-one-installation.md).

## Decision

The byte limit belongs to the account. Its default comes from the
configuration, and an administrator can change it for one account. Each
workspace still counts its own usage. A write checks the sum of the usage of
every workspace that the owner account holds against the limit of that
account. The owner pays for every byte of a workspace, whoever wrote it.

The limit replaces the quota of a workspace. The control reserve for a deletion
stays, so a deletion is possible on a full account.

`notesapp_add_usage` makes the check, so the database refuses a write over the
limit. The lock order is fixed: a write takes the lock of its workspace and
then the lock of the owner account. A workspace creation takes only the account
lock. No path takes the two locks in the other order.

## Consequences

- One account cannot fill the disk of another.
- A later plan or payment attaches to the account limit.
- An integration test proves the limit across two workspaces of one owner, and
  that two writers in the stated order finish without a deadlock.
- The directory guide of `packages/storage-server` states the lock order.
