# 0110. An installation keeps one enabled administrator

- Status: Accepted
- Date: 2026-09-26

## Context

Record 0109 gives an administrator the power to demote, disable and remove an
account, including an administrator. The last enabled administrator could
remove the role from every account, and nobody could administer the
installation again without a shell. See
[design 015](../design/015-several-accounts-on-one-installation.md).

## Decision

An installation keeps at least one enabled administrator. Two locks hold the
rule, in the shape of
[record 0051](0051-an-account-always-keeps-one-workspace.md).

The use case counts the enabled administrators under the installation lock, in
the transaction that performs the change. Record 0112 states where that lock
sits in the lock order. The use case refuses a demotion, a disable or
a removal that would leave none. A database function refuses the same change,
so a caller that bypasses the use case is refused too.

The interface hides the action that would fail. That is a courtesy and not the
guarantee.

The operator command `pnpm account:promote` can make an account an
administrator, for an installation where no administrator can sign in.

## Consequences

- No state exists where nobody can administer the installation.
- A unit test proves the refusal with its exact error code. An integration test
  proves that the database refuses it with the use case bypassed, and that two
  administrators who demote each other at the same time do not both succeed.
