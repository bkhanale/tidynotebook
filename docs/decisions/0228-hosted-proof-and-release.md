# 0228. Hosted checks prove changes and one workflow releases them

- Status: Accepted; manual release approval superseded by [0236](0236-versioned-releases-publish-without-manual-approval.md)
- Date: 2026-10-15

## Context

[Issue 390](https://github.com/tidynotebook/tidynotebook/issues/390) owns the problem, options, ordered work and timing targets. Local receipts bind proof to machine state. Release preparation repeats
proof and leaves locks that need manual recovery.

## Decision

- Required hosted checks replace local proof. `.github/workflows/ci.yml`
  runs on each PR and merge group. A document-only change runs format, the
  document check and DCO. A tested path classifier selects this narrow path; unknown paths and executable inputs run full source checks.
  The DCO statements above describe the former policy.
  [Record 0233](0233-contributions-do-not-require-sign-off.md) removes both
  the sign-off requirement and the DCO check.
- Source checks run contract, generated output, types, lint, format, build,
  unit tests, integration tests and performance budgets in parallel jobs. Shard integration tests as needed. Each job owns its database and file store. A required final check refuses failed, cancelled or unexpectedly skipped work.
- Image input changes also build and test the image in CI. Extend
  `tools/agent-context.mjs` to cover every image input. Cache native source
  archives by their checked hashes. Keep notice and runtime graph tests.
- Main requires PRs, passing checks, resolved threads and linear history.
  A merge queue tests combined changes. If unavailable, use protected auto-merge
  without the up-to-date rule, and run full checks on main after each merge.
  Red main blocks release, not the next merge. Review stays optional. No actor
  bypasses protection. Delete local receipts, review parsers and the landing
  tool. Local `pnpm verify` remains an optional diagnostic.
- Conventional commits supply release types and notes. One command selects
  a fixed landed commit and version and starts `.github/workflows/release.yml`.
  It checks version order, tag availability, tag signing and a changelog entry
  generated from the selected commit range. GitHub release notes become the
  changelog. `CHANGELOG.md` retains history through `0.19.0` and links later
  releases. No notes commit or PR, or new local process tool, is required. The local command only dispatches the workflow.
- The workflow uses pinned buildx and `concurrency: release`. It builds,
  tests and scans one image, then publishes that image by digest. It checks
  signing access and registry write access in its first minute, before any build.
  No source proof runs again. A dedicated SSH key signs the tag. The GitHub
  environment `release` requires owner approval for each run. Only its trusted
  release job reads the key and writes packages. PR jobs have neither.
- The scan blocks fixable critical or high findings outside a reviewed
  allow-list. Each exception names its finding, package, reason and expiry. Unfixable findings enter release notes automatically. A failed scan stops
  release; it is not an empty result. Rights and source notices still apply.
- The same command with the same commit and version resumes a stopped run.
  Read remote results before writes. Reuse matching stored artifacts, fill
  missing outputs and refuse a different tag, image or asset. Never move a
  signed tag or fixed image tag. A later release never moves latest backward.
- Keep source, image, operator and migration identity in official assets.
  A new manifest schema cites hosted runs instead of local receipts. Keep
  historical assets readable and fixed. Delete the local release state
  machine, before-check and publication lock. No routine release repeats
  source-opening review or standalone setup, or asks about unfixable rows.

## Consequences

This supersedes records 0212 to 0216 and 0224. It replaces local landing proof
in 0154 and 0218, the local image gate in 0204, the location of image proof in
0222, and per-release risk decisions in 0223. Other rules of those records
stay. The current tools land this record. Each replacement becomes active
with its required hosted check and deletes the old path in the same change.
Tests cover path selection, failed jobs and interrupted release writes. The dated audit measures a document change under `2 min`, source proof under
`10 min`, and release under `15 min` before issue 390 closes.
