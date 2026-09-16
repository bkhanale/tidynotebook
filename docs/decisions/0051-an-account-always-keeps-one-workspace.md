# 0051. An account always keeps one workspace

- Status: Accepted
- Date: 2026-09-16

## Context

`deleteWorkspace` in `packages/core/src/workspaces/service.ts` refuses a caller
who is not the owner, and `notesapp_delete_workspace` in
`packages/storage-server/migrations/0000_initial.sql` refuses the same caller
again. Neither of them refuses an owner who deletes their only workspace.

No screen could reach that call while
[record 0005](0005-workspace-is-an-implicit-container.md) held, so the gap was
unreachable. [Record 0049](0049-a-workspace-is-an-explicit-container.md) puts
Delete permanently in the switcher and makes it reachable. An account with no
workspace reaches the branch of `apps/web/src/app.tsx` that reports that the
account has no notes area, and no action on that screen makes one.

See [design 010](../design/010-workspaces-as-an-explicit-container.md).

## Decision

An account keeps at least one workspace. Two locks hold the rule, in the same
shape as the owner check that the product already writes twice.

`deleteWorkspace` in `packages/core/src/workspaces/service.ts` counts the
workspaces of the account inside the transaction that performs the delete and
returns `fail('forbidden')` when the count is one. The count is read under the
same lock as the delete, so two tabs that each delete one of the last two
workspaces cannot both succeed. `WorkspaceAdminTransaction` in
`packages/core/src/workspaces/ports.ts` gains the read that answers it.

`notesapp_delete_workspace` refuses the same call. The next numbered migration
replaces the function body and raises `requiredSchemaVersion`. A caller that
reaches the store without the use case is refused by the database.

The switcher hides Delete permanently when the account has one workspace,
because a control that always fails is a bad control. That is a courtesy and
not the guarantee.

The personal flag takes no part in this rule. The last workspace is protected
whether or not it is the one the account started with, and the personal
workspace can be renamed and deleted while another workspace exists.

## Consequences

- A person cannot reach a state where their account holds no notes area.
- A unit test in `packages/core/src/workspaces/service.test.ts` proves the
  refusal with the exact `DomainErrorCode`, and proves that the same delete
  succeeds when a second workspace exists.
- An integration test against real PostgreSQL proves that the database refuses
  the last workspace even when the use case is bypassed.
- Deleting an account is still not an operation of this product, so the rule
  never has to yield to one.
