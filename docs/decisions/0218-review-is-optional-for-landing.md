# 0218. Review is optional for landing

- Status: Accepted. Process parts superseded by [0228](0228-hosted-proof-and-release.md)
- Date: 2026-10-10

## Context

Records 0212 and 0214 made a completed Codex review of the exact head a
condition of landing. `tools/lifecycle.mjs` enforced it. The owner decides that
a change no longer needs a review to land.

## Decision

A change lands without a review, by Codex or by anyone else. Landing still
needs a pull request against main, `pnpm verify` proof of the exact head
through `tools/lifecycle.mjs`, passing checks, current remote main as an
ancestor, and a non-force push of the exact head. The tool still reads the
merged tree. A rejected push is a stop.

A review stays optional. The owner may ask for one. Then each open finding of
it is fixed, and each review thread is resolved before landing.
`pnpm lifecycle review` requests a Codex review only with `--request-review`.
The commands `review` and `review-status` keep working.

This refines records 0212 and 0214. Record 0214 still describes how the tool
reads a completed automatic review.

## Consequences

Landing is faster and a lone owner is not blocked. A defect that a review would
find must be found by the proof and by the owner. The gate no longer proves
that a review happened. `tools/lifecycle.test.mjs` proves that a proved ready
head lands with no review and that open threads still refuse.
