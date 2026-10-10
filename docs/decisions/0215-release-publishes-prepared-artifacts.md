# 0215. Release publishes prepared artifacts

- Status: Accepted
- Date: 2026-10-10

## Context

The owner requires a fast release with no repeated source checks or proof
work. `tools/release.mjs` combines source preparation, review, tests,
publication, milestone maintenance and a further release gate.

## Decision

Preparation owns release notes, source review and the source and image gates.
Release publishes the prepared image, fixed signed tag and official assets.
It runs no source gate, image test, review, milestone operation or release
gate. Readback of a write still checks the intended source and artifact.
This replaces the release phase rules of records 0204, 0212 and 0213.

Prepared images and release inputs have remote storage. A runner can read
them without the workstation that prepares them. Local files are temporary
working copies. No local receipt is a publication requirement.
The version tag stays fixed. An uncertain write needs readback before retry.

## Consequences

Preparation takes the build and test work. Publication takes remote reads
and writes only. A missing preparation stops release with its next action.
The normal source gate remains required before landing. Consumers keep the
official source, image and operator contract fields.
