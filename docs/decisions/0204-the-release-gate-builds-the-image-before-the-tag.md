# 0204. The release gate builds the image before the tag

- Status: Accepted
- Date: 2026-10-04

## Context

`pnpm verify` builds the workspace from the whole checkout. The image of
`.github/workflows/release.yml` builds from the context that `.dockerignore`
keeps, and it runs only after a tag is pushed. A pushed tag is final, so a
fault that only the image build finds costs a version. The tag of 0.13.0 has
no image, because the install ran before the patches were copied. The tag of
0.14.0 has no image, because the root `tsc` read a tool test that imports
`apps/docs`, which the context leaves out. `pnpm verify` passed both times.

The before gate of `tools/release-check.mjs` also refused any branch but
`main`. A release then left its worktree for the main checkout, against the
rule that work stays inside the active worktree.

## Decision

- The before gate builds the image from the prepare commit, as the workflow
  does. `git archive` of `HEAD` is the context, so the build reads the
  committed tree and `.dockerignore`, and no file that is not committed. The
  build exports no image. A host with no Docker fails the gate.
- `tools/check-versions.mjs`, in `pnpm lint`, refuses a file that the root
  `tsconfig.json` includes and the context keeps when it imports a file that
  the context leaves out. The tests of the tools stay out of the context.
- The before gate asks that `HEAD` is the tip of `main` and holds
  `origin/main`, not that the branch is named `main`. The release runs from
  its worktree.
- The release workflow names its runner image, so a change of
  `ubuntu-latest` does not change the image build between two releases.

## Consequences

- The before gate takes the time of one image build.
- A fault of the image build stops the release before the tag, where a repair
  is free.
- `tools/release-check.test.mjs` and `tools/check-versions.test.mjs` hold each
  rule, with the fault of 0.14.0 as a regression case.
