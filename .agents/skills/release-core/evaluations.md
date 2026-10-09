# Evaluations for release-core

Each case uses an isolated fixture repository and command adapters. It sends no
write to a live release, registry, or host. tools/lifecycle.test.mjs checks the
release chain and recovery. tools/release-check.test.mjs checks gate refusals.

## An authorized release

Request: Release the current merged changes, with an optional version override.

- Checks CLI attestation support before any prepare write.
- Reads reviewed merged PR release metadata. Uses the strongest release type
  and the pre-stable policy. Rejects an override below that step.
- Runs the release command. Keeps the saved source, date, and prepare commit
  fixed. A resume after midnight makes no new prepare commit.
- Proves and reviews the prepare PR. Lands its exact commit through the normal
  review gate. A merged PR alone gives no proof of a checked landing attempt.
- Proves the fixed source and image before it signs and pushes the fixed tag.
- Binds provenance to the repository, workflow, source commit, and tag ref.
- Publishes notes from the changelog and both exact release assets. Reads them
  back before the milestone write. Completes only after the after gate passes.

## A wait or interrupted write

Request: Resume the saved release after review or an interrupted external write.

- Reads status and the actual target before it sends another write.
- Waits for review or image completion with a bound. Keeps current proof.
- Reads a successful exact main push through its saved validated attempt.
- Accepts an uncertain tag push only when the remote tag object and source match.
- Adds only a missing exact asset after a read. A zero-exit partial upload stays
  at publication. A differing asset stops before another upload or milestone.
- A failed network or authorization read does not mean the target is absent.

## An identity fault

Request: Repair a release with a changed tag, image, or prepare merge.

- Stops on a changed tag object, changed source, external squash, or changed
  repository. Never moves, deletes, or force pushes a published tag.
- Rejects a new registry digest with the same source label and provenance from
  the same repository and workflow for a different source or ref.
- Rejects a missing or changed manifest or operator contract in the after gate.
- A legacy release gets no invented manifest, provenance, or saved proof.

## A failed image or open milestone

Request: Finish a release whose image fails or whose milestone has open work.

- Keeps a failed published tag fixed and publishes no release for its image.
- Fixes the cause through the normal change units. Uses the next patch for the
  repaired release.
- Stops on open milestone work. Reports the rows that need an owner decision
  before it closes or moves them. Does not change the scope of those rows.
