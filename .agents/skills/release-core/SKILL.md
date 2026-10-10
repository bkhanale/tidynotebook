---
name: release-core
description: Prepares core release assets, then publishes the remote prepared result. Use for an explicit core release or a stopped preparation or publication. A source request does not start a release.
---

# Release core

Start with an explicit release request. [Record 0215](../../../docs/decisions/0215-release-publishes-prepared-artifacts.md) separates preparation and publication.

Preparation derives the version and notes from merged PR metadata. It owns the
notes PR, review, source gates and one tested image. It uploads the image under
its fixed source name and stores official assets in a draft GitHub release:

```sh
pnpm release:prepare
pnpm release:prepare --status
pnpm release:prepare --resume
```

Complete a pending notes PR through [review-change](../review-change/SKILL.md),
then resume preparation. A missing prepared asset is a preparation dependency.

Publication reads the remote prepared assets. It runs no build, test, review,
milestone work or release gate. It needs no local image or receipt:

```sh
pnpm release
pnpm release "$VERSION" --status
pnpm release "$VERSION"
```

Publication creates the fixed signed source tag, copies the prepared image
reference to the version and latest aliases, and publishes the draft release.
The version can be explicit on a different runner. Readback checks each write.
A differing version tag, image or asset stops the run. Never move a fixed tag.
End when the official release names the intended source and image.
