# 0112. The owner account holds the storage quota

- Status: Accepted
- Date: 2026-09-26

## Context

Each workspace has its own quota record, with a default from
`packages/storage-server/src/provision.ts`, and an account can create
workspaces with no limit. One account can therefore fill the disk of every
other account. A limit of the account adds an account lock beside the
workspace lock, and records 0110 and 0111 add an installation lock and a
removal that takes many workspace locks. See
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
limit.

Every path takes its locks in one order, and takes only the ones it needs:

1. The installation lock.
2. The workspace locks, in the order of the workspace identifier.
3. The account locks, in the order of the account identifier.

A write takes its workspace lock, then the lock of the owner account. A
workspace creation takes the account lock. A demotion, a disable or a removal
of an account takes the installation lock first, because record 0110 counts
the administrators under it. A removal takes all three kinds, in this order.

## Consequences

- One account cannot fill the disk of another.
- A later plan or payment attaches to the account limit.
- An integration test proves the limit across two workspaces of one owner, and
  that a write and a removal that run at the same time both finish.
- The directory guide of `packages/storage-server` states the lock order.
