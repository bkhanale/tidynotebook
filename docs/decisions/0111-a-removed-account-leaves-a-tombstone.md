# 0111. A removed account leaves a tombstone

- Status: Accepted
- Date: 2026-09-26

## Context

[Record 0051](0051-an-account-always-keeps-one-workspace.md) says that deleting
an account is not an operation of the product. A service for several people
needs one, and a public service must let a person remove their own account.
`notesapp_delete_workspace` cannot do it: it refuses a caller who is not the
owner, and it refuses the last workspace of an account. A revision names its
author through a foreign key to the account, and in a shared workspace a
revision outlives its author. See
[design 015](../design/015-several-accounts-on-one-installation.md).

## Decision

**Disable** is reversible. The server revokes every session of the account.
A session create hook of Better Auth asks one narrow `SECURITY DEFINER`
function whether the account is enabled, and refuses the session when it is
not. The actor resolver refuses the account as well. The notes stay. An
administrator disables and enables an account.

**Remove** erases an account. One removal function takes the locks in the order
of record 0112 and deletes, for each workspace of the account, the rows that
`notesapp_delete_workspace` deletes. Attachments go to the reclaim queue and
published links go with their workspace. The identity user, the sessions, the
preferences, the settings and the audit trail go too. The function checks that
the caller is the account itself or an administrator.

The account row stays as a tombstone. It keeps its identifier and a removal
time, and it holds no identity, no address, no name and no setting. No session
can resolve to it. A revision that names it keeps a valid reference.

A person removes their own account after they enter their password again. An
administrator removes another account. Record 0110 refuses the removal of the
last enabled administrator.

This refines record 0051. Its rule still holds for every account that exists.

## Consequences

- A person can leave the service and take their notes first through export.
- The sharing design shows a removed author without a change of shape.
- A device of a removed account learns it on its next session check. Its local
  data stays until sign-out, as for any lost access.
- A backup keeps the data of a removed account until the backup expires. The
  operator states that retention in the privacy notice (record 0120).
- Integration tests prove that removal leaves no identity, no session and no
  workspace, that the tombstone resolves to no actor, and that a disabled
  account gets no new session.
