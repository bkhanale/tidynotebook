# 0116. One password policy follows NIST SP 800-63B revision 4

- Status: Accepted
- Date: 2026-09-26

## Context

Five files state the minimum length of a password:
`apps/server/src/auth/better-auth.ts`, `apps/server/src/cli/bootstrap.ts`,
`apps/web/src/lib/password-policy.ts`,
`packages/api-contract/paths/api_setup.yaml` and
`packages/api-contract/components/schemas/CreatePublishedLinkInput.yaml`. The
minimum is shorter than NIST SP 800-63B revision 4 asks for a password that is
the only factor, and no check refuses a breached password. See
[design 016](../design/016-a-public-service.md).

## Decision

The password rule follows revision 4: the minimum that it sets for a password
that is the only factor, a maximum that allows a passphrase, no composition
rule, and no forced rotation.

`packages/core` holds the bounds. The server, the operator commands and the web
client read them from there. One contract component states the same bounds, and
every password field references it. A contract test fails when the two differ.

A new or changed password is checked against the range service of Have I Been
Pwned through the Better Auth plugin, from the server only. The service sees
the first five characters of the SHA-1 digest and nothing else. When the
service does not answer, the check accepts the password and writes a log event.
The configuration can turn the check off for an installation with no outbound
network.

The rule applies when a password is set or changed. An existing password still
signs in.

## Consequences

- One source states the rule, and the gate refuses a second copy that drifts.
- A breached password cannot become a new password while the service answers.
- The password of a published link follows the same rule.
- A second factor is a later design.
