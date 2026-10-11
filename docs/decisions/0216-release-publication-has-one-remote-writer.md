# 0216. Release publication has one remote writer

- Status: Accepted
- Date: 2026-10-10

## Context

Separate runners can read the same latest release before either publishes.
A version comparison alone cannot stop the older runner from moving the
registry alias and GitHub release pointer backward.

## Decision

`tools/release-publish.mjs` takes one repository lock through the GitHub
variable API. Creation is atomic and never updates an existing owner.
The lock has a unique run identity and the selected version. Publication
reads the latest version and writes all release pointers while it holds
the lock. Only that run can release it.

A successful publication releases the lock. A failure before any remote
publication write also releases it. An uncertain publication keeps the
lock. Recovery first confirms that the writer has stopped and reads its
remote results, then removes the lock and resumes the selected version.
No automatic expiry or takeover permits a second writer.

This extends record 0215. It adds no source test or build to publication.

## Consequences

All runners share one publication boundary. A competing run stops before
its release writes. The publishing credential needs variable write access.
`tools/lifecycle.test.mjs` checks competing owners, lost replies and recovery.
