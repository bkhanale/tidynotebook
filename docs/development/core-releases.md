# Core images

`release.yml` is the only core image publication path. Each main push builds
and proves native amd64 and arm64 images, then publishes
`ghcr.io/tidynotebook/tidynotebook:main` and the compatibility name
`ghcr.io/tidynotebook/core:main`. Fast forward merges use `GITHUB_TOKEN`, which
does not trigger push workflows. Both merge workflows therefore dispatch this
workflow on main after a successful merge. A manual run on main can recover a
failed dispatch. Late runs stop if main has moved. Each ref has its own
concurrency group, so version approval cannot block main or another version.

An existing stable tag `vMAJOR.MINOR.PATCH` selects a version. Push the tag or
run the workflow manually on that tag. The source must be on main. The latest
same-repository push CI must have a successful `Check` on that exact SHA from
GitHub Actions app `15368`. A PR branch push supplies this proof after a fast
forward merge. Fork runs and checks from other apps cannot supply it.

Both native images pass the distribution source and notice proofs before
publication. Builds read `ghcr.io/tidynotebook/tidynotebook/ci-cache:amd64` and
`:arm64`; they do not write caches. Tested image archives expire after one day.
Publication checks each immutable artifact ID and the SHA-256 of its ZIP
against the native build outputs before extraction. It uses Skopeo to copy the
tested images by digest without a rebuild or public architecture tags. Conversion
rewrites the config and recompresses layers. Publication checks that labels and
uncompressed layer digests match the tested image, then checks that the final
index contains exactly the pushed image digests.

Publish jobs use Ubuntu 24.04 and require Skopeo `1.13.3`; a missing or different version stops publication. Version `v1.2.3` publishes
`:1.2.3`. Existing version tags cannot be replaced. There is no `latest` alias.

The primary index is created once. Skopeo copies that index and all native
images to the compatibility name with digest preservation. Readback must
confirm the same index digest and contents under both names. Each name has
GitHub OIDC provenance, with no stored signing key.

Before a stable version writes either package, both version tags must be
absent. Existing stable version tags are never replaced. Historical `core` tags and digests
stay usable; this workflow does not rename, delete, or backfill old images.

A failed copy can leave one name published. The run then fails and reports no
successful digest output. Do not delete or move that fixed tag to retry.
Recover an incomplete publication only after a separate review of the
published digest and the tested artifacts.

Version publication requires the `release` environment. The owner is its sole
required reviewer. Allow only tags `v*`. Disable administrator bypass. Keep
prevent self-review off so the sole maintainer can start and approve a run.
Use no wait timer and no environment secrets. Create this environment before
the first version run. The workflow checks its protection before use and again
after approval. Automatic main publication has no environment approval.

The run summary gives the source SHA and both image addresses with the same
index digest. Use `ghcr.io/tidynotebook/tidynotebook` for new pins. Existing
`core` pins remain valid. See
[Image names and existing pins](../guide/published-images.md#image-names-and-existing-pins)
for the operator steps. Downstream source and image pins must identify the
same version. This workflow does not deploy an installation.

This activates image publication from decision 0228 with stable tags supplied
by the maintainer. It replaces its local dispatch command, SSH tag signing,
release notes, and resumable publication design. It creates no Git
tags or GitHub Releases. Distribution and notice checks remain required.
Vulnerability scanning is follow-up work and is not a publication gate yet.
