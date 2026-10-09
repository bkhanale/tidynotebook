# 0213. Build and publish one release image

- Status: Accepted
- Date: 2026-10-09

## Context

The release builds an image locally, then builds it again in GitHub.
GitHub attestation also requires a provider feature that some repositories lack.
The owner controls the source, the release command, and the registry.

## Decision

`tools/release.mjs` publishes the exact local image that passes image proof.
The image carries its source label before tests run. Publication adds tags only.
The command reads the registry before a retry and refuses a different image.
The signed source tag and official assets bind the version, source, and digest.
GitHub attestation and a second image build are not release requirements.
This replaces the publication and provenance requirements of record 0212.
The before image gate of record 0204 remains required, and exports the image.
Verification builds the workspace once before the unit and integration tests.

## Consequences

The release needs local registry write access. It has no image job wait.
Consumers trust the owner publication rather than a GitHub build certificate.
Source review, image tests, immutable tags, and asset identity still apply.
`tools/lifecycle.test.mjs` proves publication and recovery with the tested image.
