# Core images

`release.yml` is the only core image publication path. Each main push builds
and proves native amd64 and arm64 images, then publishes
`ghcr.io/tidynotebook/core:main`. Fast forward merges use `GITHUB_TOKEN`, which
does not trigger push workflows. Both merge workflows therefore dispatch this
workflow on main after a successful merge. A manual run on main can recover a
failed dispatch. Late runs stop if main has moved.

An existing stable tag `vMAJOR.MINOR.PATCH` selects a version. Push the tag or
run the workflow manually on that tag. The source must be on main. The latest
same-repository push CI must have a successful `Check` on that exact SHA from
GitHub Actions app `15368`. A PR branch push supplies this proof after a fast
forward merge. Fork runs and checks from other apps cannot supply it.

Both native images pass the distribution source and notice proofs before
publication. Builds read `ghcr.io/tidynotebook/tidynotebook/ci-cache:amd64` and
`:arm64`; they do not write caches. Tested image archives expire after one day.
Publication loads these archives without a rebuild. It publishes two run-specific
architecture tags and one multi-architecture index. Version `v1.2.3` publishes
`:1.2.3`. Existing version tags cannot be replaced. There is no `latest` alias.
The index has GitHub OIDC provenance, with no stored signing key.

Version publication requires the `release` environment. The owner is its sole
required reviewer. Allow only tags `v*`. Disable administrator bypass. Keep
prevent self-review off so the sole maintainer can start and approve a run.
Use no wait timer and no environment secrets. Create this environment before
the first version run. The workflow checks its protection before use and again
after approval. Automatic main publication has no environment approval.

The run summary gives the source SHA and image index digest. In a separate
cloud PR, set `core.json.ref` to that SHA and `core.json.image` to
`ghcr.io/tidynotebook/core@sha256:<index digest>`. Cloud source sync and deployment
then use the same core version. This workflow does not deploy cloud.

This activates image publication from decision 0228 with stable tags supplied
by the maintainer. It replaces its local dispatch command, SSH tag signing,
release notes, and resumable publication design. It creates no Git
tags or GitHub Releases. Distribution and notice checks remain required.
Vulnerability scanning is follow-up work and is not a publication gate yet.
