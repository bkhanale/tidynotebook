# 0236. Versioned releases publish without manual approval

- Status: Accepted
- Date: 2026-10-24

## Context

Owner decision on 2026-10-24: versioned core releases publish without manual
approval. A required reviewer on the release environment creates a manual
step after the source and CI checks have passed.

## Decision

The `release` environment has no required-reviewer rule. The workflow refuses
such a rule if it is added again, including one with an empty reviewer list.
The environment allows only `v*` tags through its custom branch policy and
keeps administrator bypass disabled.

Source proof, a passing `Check` on the exact source SHA, and the native image
proofs remain required. The source must be on main. The PR merge gate is
unchanged. This replaces only the manual release-approval clause of
[decision 0228](0228-hosted-proof-and-release.md).

## Consequences

Version publication needs no reviewer action after a valid tag starts the
workflow. Environment drift fails closed. Repository settings must remove
the old reviewer rule before a version release can pass the new guard.
