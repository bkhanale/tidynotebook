# Core images

`release.yml` is the only core image publication path. Each main push builds
and proves native amd64 and arm64 images, then publishes
`ghcr.io/tidynotebook/tidynotebook:main`. Fast forward merges use `GITHUB_TOKEN`, which
does not trigger push workflows. Both merge workflows therefore dispatch this
workflow on main after a successful merge. A manual run on main can recover a
failed dispatch. Late runs stop if main has moved. Each ref has its own
concurrency group, so publication on one ref cannot block another.

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
index contains exactly the pushed image digests. Publish jobs use Ubuntu 24.04
and require Skopeo `1.13.3`; a missing or different version stops publication. Version `v1.2.3` publishes
`:1.2.3`. Existing version tags cannot be replaced. New publication does not write a `latest` alias. Historical `latest` aliases
remain at their old images; do not use them for a new installation.
The index has GitHub OIDC provenance, with no stored signing key.

Version publication requires the `release` environment, with no required
reviewers. Allow only tags `v*` through its custom branch policy. Disable
administrator bypass. Use no wait timer and no environment secrets. Create
this environment before the first version run. The workflow checks its
protection before building and again before publication. A required-reviewer
rule or wait-timer rule stops the workflow, even with an empty reviewer list
or a zero timer. Versioned releases
publish without manual approval, under
[decision 0236](../decisions/0236-versioned-releases-publish-without-manual-approval.md).
Automatic main publication also has no environment approval.

The run summary gives the source SHA and image index digest. In a separate
cloud PR, set `core.json.ref` to that SHA and `core.json.image` to
`ghcr.io/tidynotebook/tidynotebook@sha256:<index digest>`. Cloud source sync and deployment
then use the same core version. This workflow does not deploy cloud.

This activates image publication from decision 0228 with stable tags supplied
by the maintainer. It replaces its local dispatch command, SSH tag signing,
release notes, and resumable publication design. It creates no Git
tags or GitHub Releases. Distribution and notice checks remain required.
Vulnerability scanning is follow-up work and is not a publication gate yet.

## Release maintenance

For each stable release, update the install example to its real source tag
and verify both install guides with its manifest and image digest. Test the
published platforms before changing the platform list. Never replace an
existing version tag or digest to add a platform. Before the install guides
select a new stable release, update them with its exact tag and verified image
digest.

## Image package access

New main and version images publish only to the public
`ghcr.io/tidynotebook/tidynotebook` package. Before the image-name change
merges, verify these GitHub package settings:

- Visibility is Public.
- The package is linked to `tidynotebook/tidynotebook`.
- Manage Actions access gives that repository Write access.

The publication script checks public visibility and the linked repository
before any registry write. The workflow token has package write permission.
Both tested native images go into one index with GitHub OIDC provenance.
Existing `core` tags and digests are never copied, updated, or deleted by the
new workflow. [Decision 0237](../decisions/0237-new-images-use-the-public-tidynotebook-package.md)
replaces the earlier image-name policy. See the
[migration note](../guide/published-images.md#image-names-and-existing-pins)
before changing an existing pin.

## A failed publication

A version tag is fixed after the registry accepts it. A failed final check or
attestation can leave that tag published without a successful release run.
Do not delete, move, or replace the tag to retry. Do not create a GitHub
Release or deploy that image until the index, both native images, and its
provenance are verified.

Record the workflow URL, source SHA, image index digest, native child digests,
and tested artifact IDs. Use `docker buildx imagetools inspect` with the full
image address and digest to read the index. Use `gh attestation verify
oci://ghcr.io/tidynotebook/tidynotebook@sha256:<index digest> --repo
tidynotebook/tidynotebook` to check provenance. Keep the tested artifacts before
their one-day expiry. A recovery that writes missing provenance needs a
separate reviewed workflow for that exact published digest and its original
tested artifacts. The normal publication path has no resume mode and refuses
an existing fixed tag. This image-name change adds no recovery write path.
