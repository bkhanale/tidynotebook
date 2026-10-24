# 0237. New images use the public tidy notebook package

- Status: Accepted
- Date: 2026-10-24

## Context

The owner wants self-hosters to use the product image name. The existing
`tidynotebook` package was private, and record 0220 selected `core` for public
publication. Existing installations pin images from both package names.

## Decision

Publish new main and version images only to
`ghcr.io/tidynotebook/tidynotebook`. Make that package public and grant
`tidynotebook/tidynotebook` repository Actions Write access before merge.
The publication guard requires public visibility and the linked repository.
This replaces the image-name and private-package policy in
[0220](0220-future-releases-use-a-new-public-image.md).

Keep every existing `core` tag and digest. Do not copy new images to `core`,
backfill old releases, or change historical `latest` aliases. Both native
architectures remain tested before publication. One index names those exact
images and has GitHub OIDC provenance. Fixed version tags cannot be replaced.
The release environment policy from
[0236](0236-versioned-releases-publish-without-manual-approval.md) stays in force.

## Consequences

Self-hosters upgrade with the new release's complete image address and
digest, with its matching source checkout. Replacing only the package name in
an old pin is unsafe. Historical manifests keep their original package.
The selector accepts both official names without rewriting old digests.
Old `tidynotebook` releases become publicly readable when the package opens.

The cloud needs a separate image pin change and deployment. This change
creates no version tag, GitHub Release, or deployment. A failed attestation
requires a separate reviewed recovery; it never permits a fixed tag rewrite.
