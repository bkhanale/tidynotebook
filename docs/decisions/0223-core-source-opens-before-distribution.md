# 0223. Core source opens before distribution

- Status: Accepted. Process parts superseded by [0228](0228-hosted-proof-and-release.md)
- Date: 2026-10-13

## Context

The owner approves opening the core source before an image release or cloud
launch. The earlier timing rule couples source access to separate work.
[Design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md) and
[plan 021](../plans/021-open-source-readiness.md) carry the active scope.

## Decision

The core source can open after its exact source and image gates, hosted
checks, material review and fresh standalone setup pass and the source change
lands. The owner performs the repository visibility switch. Public control
readback and anonymous source access checks follow that switch.

This supersedes only the opening-time rule in record 0188 and its reference
in record 0220. AGPL-3.0-only, DCO, ownership and the core boundary stay.
The sign-off guidance is replaced by [record 0233](0233-contributions-do-not-require-sign-off.md).

Image publication and cloud launch do not block source opening. They remain
separate work that needs its own authorization and proof.

The old image package stays private with separate grants. All fixed versions,
tags and digests stay intact. Source opening accepts no image-specific risk
and grants no image publication, package visibility change or live deployment.

## Consequences

Contributors can build the public source before a public image exists.
Future image publication still needs source and notice rights, current image
security review and an explicit disposition of retained risks. The cloud
still needs its validation change before it uses the new package.
`docs/development/open-source-launch.md` separates source opening from
future distribution. The active cloud plan no longer owns source opening.
