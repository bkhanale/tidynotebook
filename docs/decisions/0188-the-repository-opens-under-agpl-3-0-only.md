# 0188. The repository opens under AGPL-3.0-only

- Status: Accepted. Opening time superseded by [0223](0223-core-source-opens-before-distribution.md). Sign-off requirement superseded by [0233](0233-contributions-do-not-require-sign-off.md)
- Date: 2026-10-04

## Context

The repository is private and carries the MIT license. When it opens, MIT lets
a competitor run a changed copy as a paid service with no duty to share it.
A source-available license would break the promise of a free open-source
edition. AGPL is the common license of open notes products that also sell a
cloud: Joplin, Standard Notes, Logseq, AppFlowy and Trilium. The owner holds
every copyright today. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- `LICENSE` becomes the text of AGPL-3.0-only before the repository opens.
  Each `package.json` states `AGPL-3.0-only`.
- A contribution comes in under the same license, with a Developer Certificate
  of Origin sign-off on each commit. No contributor license agreement.
- The cloud runs the public image of a public release with no change, so it
  meets the same terms as any other host.
- The private billing service of record 0186 is a separate program that talks
  to the core over HTTP only. It is not a part of the core, so the license of
  the core does not reach it, and it needs no right over a contribution.
- The repository opens on the day the cloud launches, as the last item of
  [plan 019](../plans/019-tidy-notebook-cloud.md).

## Consequences

- A changed copy that serves users must offer its source to them.
- `CONTRIBUTING.md` states the sign-off. `.github/workflows/dco.yml` runs on
  each pull request and fails when a commit of it has no `Signed-off-by`
  line. A commit of the owner needs none, because the owner holds the
  copyright.
- The README and the site state the license of the self-hosted edition.
