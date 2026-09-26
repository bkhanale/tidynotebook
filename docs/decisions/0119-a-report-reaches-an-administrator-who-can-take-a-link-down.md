# 0119. A report reaches an administrator who can take a link down

- Status: Accepted
- Date: 2026-09-26

## Context

A stranger can publish a phishing page or a harmful attachment. Nobody can
report it, and only the owner can revoke it. Record 0109 keeps an
administrator out of every workspace of another account. See
[design 016](../design/016-a-public-service.md).

## Decision

A published page carries a plain link to a report page on the published origin.
The report page is a form that the server builds, with no script. A report
holds the publication, a reason from a fixed list and an optional note. The
report attempts count per client address, and per /64 prefix for IPv6.

A report is the second write of the reader path, after
`publication-unlock.ts`. It runs through one function that takes the token
digest, inserts one report row, and reads and writes nothing else. The
transaction of every other reader request stays read only. This refines
[record 0031](0031-the-reader-path-is-a-closed-read-only-boundary.md).

An administrator lists the open reports. The administrator opens the link as
any reader does. A takedown revokes the publication through a
`SECURITY DEFINER` function that checks the installation role and sets the
revocation and its reason. It does not add a membership, so the administrator
still reads no note that the owner did not publish.

The owner sees that an administrator took the link down. The owner cannot make
that link live again. A repeated abuse leads to a disable by record 0111.

## Consequences

- A public installation can act on abuse without a shell and without reading
  private notes.
- An integration test proves the takedown and that the administrator reads no
  other row of that workspace. A test of the served page proves that the report
  page holds no script.
