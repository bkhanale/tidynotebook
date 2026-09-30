# 0136. The initial JavaScript budget follows the inequality gap

- Status: Accepted
- Date: 2026-10-01

## Context

`tools/performance/bundle-budget.mjs` holds the compressed JavaScript budget
of the first route, and the performance job of `.github/workflows/ci.yml`
runs it. The budget was a round figure with no stated source. The first
route grew past it, so the job failed on `main` for every change. The owner
asked for a budget from an industry standard.

## Decision

- The budget is the JavaScript share of the 3-second critical-path budget
  for a JS-heavy page in The Performance Inequality Gap, 2026, by Alex
  Russell (https://infrequently.org/2025/11/performance-inequality-gap-2026/).
  That budget is for a P75 phone and network, in compressed bytes.
- NotesApp is a JS-heavy page: an editor that works offline. The JS-light
  figure of the same table is for a page of mostly markup and images.
- The script holds the value and names the source beside it. A later
  edition of the source is a new record.

## Consequences

- The job fails when the first route reads more JavaScript than a P75 phone
  can take in 3 seconds.
- The budget is looser than the round figure before it. It does not say that
  the first route is small. The Markdown renderer, KaTeX and Yjs load on the
  first route now, and a split of them is separate work.
- `docs/development/verification.md` points at this record.
