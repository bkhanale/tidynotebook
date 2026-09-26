# 0109. The installation role grants no workspace access

- Status: Accepted
- Date: 2026-09-26

## Context

Every rule in `packages/core/src/identity/actor.ts` belongs to one workspace.
Nothing can list, invite, disable or remove an account. The Better Auth admin
plugin can, but it stores the role on the identity user, where the runtime role
cannot read it, and it mounts an impersonation route. See
[design 015](../design/015-several-accounts-on-one-installation.md).

## Decision

Each account has an installation role: `administrator` or `member`. The role
is a column of the application account. The first account is an administrator.

`packages/core` decides installation actions with a second matrix beside the
workspace matrix. The installation actions are: list accounts, invite, revoke
an invitation, disable, enable, remove, change an installation role, change the
registration policy, read reports, and take down a link. The two matrices never
read each other. The role is read in the same transaction as the action.

An administrator sees the name, the address, the state, the last activity and
the usage of an account. An administrator is not a member of any workspace of
another account. Every row access policy reads membership only, so the database
hides every note of another account from an administrator.

A write that crosses accounts, such as a takedown in record 0119, is a
`SECURITY DEFINER` function that checks the installation role and changes one
narrow fact.

The Better Auth admin plugin and impersonation are excluded.

## Consequences

- Administration lives in the application and not only in a shell.
- The sharing design adds workspace roles without a change to this matrix.
- A unit test in `packages/core` proves the matrix and each refusal. An
  integration test proves that an administrator reads no row of another
  workspace.
- An administrator action writes an entry in the audit trail.
