# 0118. A published page of a public installation has its own origin

- Status: Accepted
- Date: 2026-09-26

## Context

Records 0031, 0046 and 0047 serve a published page with no script, no cookie
and no shell, on the origin of the application. On a public installation a
stranger publishes. A browser block list acts on a whole host, so one phishing
page can block the application for every person.
[Record 0039](0039-one-list-of-served-origins.md) holds one list of served
origins, and every origin on it is trusted for a cookie write. See
[design 016](../design/016-a-public-service.md).

## Decision

An installation can name a published origin. That origin serves the reader
path of a published link, its attachments and its report page (record 0119),
and nothing else. It sets no cookie, answers no API operation and serves no
application shell.

The list of served origins gives each origin a role: `application` or
`published`. The cookie write check, the trusted origins of Better Auth and the
Host allowlist read the one list. Only an `application` origin is trusted for a
write or a cookie. The application origin answers a reader address with a
temporary redirect to the published origin. A browser keeps a permanent
redirect forever, and an operator can move the published origin later.

An installation with no published origin serves the reader path as it does now.
The `open` registration policy requires a published origin (record 0114).

This refines records 0039 and 0031.

## Consequences

- A block of a published page does not block the application.
- The operator of a public installation runs a second host name and its
  certificate.
- Integration tests prove that the published origin answers no API route and
  sets no cookie, that a write that names it is refused, and the redirect.
