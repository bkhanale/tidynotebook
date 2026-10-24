---
name: release-core
description: Publish an authorized core version through the tag-driven release workflow and verify its image. Does not deploy an installation.
---

# Release core

Use this skill for an explicit core release request. A merge task alone does
not authorize a version tag or release. Honor release authorization already
given in the session; do not ask for it again.

Read [Core images](../../../docs/development/core-releases.md) and use
`.github/workflows/release.yml` as the publication path. Check the current main,
release tags, published versions, package access, and release environment
before selecting the version. Do not replace a published version.

Prepare the changelog and any release instructions through the repository PR
and merge process. Use the exact main source SHA with successful same-repository
push CI proof. An authorized stable version uses an annotated `vMAJOR.MINOR.PATCH`
tag on that SHA. Push only that tag. The tag starts the release workflow.

Confirm that the workflow succeeds. Read back the public image index and both
native child digests. Verify GitHub provenance for the exact index digest and
confirm anonymous registry access. Keep the source SHA, tag, workflow URL,
image digests, and provenance result as release evidence.

Generate the GitHub Release notes with `tools/release-notes.mjs` from the
committed changelog. Create the release only after publication and provenance
verification. Complete the install-guide update described under Release
maintenance in the release guide.

Keep existing tags, digests, and release assets fixed, including old image
packages. Never force push. If a fixed tag already exists after a failed run,
follow the failed-publication guidance; do not delete or replace it to retry.
A release request does not authorize a cloud deployment or package cleanup.
