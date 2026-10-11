# 0220. Future releases use a new public image

- Status: Accepted
- Date: 2026-10-11

## Context

The owner approves a separate public image package for future releases. The
old package stays private. Its fixed releases, tags, and digests stay intact.
The preparation and publication tools derive the old package from the full
repository name. A new policy must separate the package from that name.

## Decision

`tools/release-registry.mjs` selects the core package of the repository owner
for future preparation and publication. This supersedes only the image-name
part of the final decision bullet in
[record 0187](0187-the-product-is-tidy-notebook-on-tidynotebook-com.md).
Its product, domain, and repository choices stay in force. The tools refuse publication of a
draft that names an old package before they acquire a remote publication
lock or write a tag or an image alias. The operator must prepare a new draft.

A fixed published manifest selects the package for read-only status and
release checks. A release with no manifest uses its fixed historical workflow.
A release with neither uses the future package. An old published release
permits read-only status only. The tools never redirect its fixed assets.

The local Compose image name stays the same. Record [0188](0188-the-repository-opens-under-agpl-3-0-only.md)
still controls the repository opening time. This change does not publish an image or
change package access.

## Consequences

Future consumers read the new image address from the official manifest.
Current private image pins stay intact. The cloud pin format accepts the new
address. Its release and image source checks still require the old package.
The private cloud needs a validation change before it can consume a future
core package release. The operator API and the migration interface do not change.

`tools/release-registry.test.mjs` checks package selection and refusal.
`tools/lifecycle.test.mjs` checks preparation, publication, and read-only
legacy checks with a repository name that differs from the image package.
