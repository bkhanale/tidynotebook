# 0193. Published transfer has a limit for each account and for the installation

- Status: Accepted
- Date: 2026-10-04

## Context

Readers of a published page are strangers, so their traffic is the one cost
that an account does not bound by itself. Each byte that leaves the host costs
the operator money. The reader path writes nothing today (record 0031), and a
database write for each answer would make each page view cost a write. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- The reader path in `apps/server/src/routes/published.ts` counts the bytes
  of each page and each attachment that it sends, at the response boundary,
  for the owner account of the workspace. `published-document.ts` stays a
  builder of HTML with no store.
- Each process adds the bytes to a sum in memory for each account, and writes
  the sums to one monthly table every `10 s`. A check reads the stored total
  of the month and adds the sum of its own process.
- Past the transfer limit of an account (record 0189), the reader path answers
  the closed page of record 0146 for each link of the account until the next
  month in UTC. The owner sees the state on the published links page.
- `NOTESAPP_PUBLISHED_TRANSFER_CAP_BYTES` bounds the sum of every account in
  one month. Past it, the reader path answers the closed page for every link
  until the next month.
- With no limit and no cap, nothing is counted.
- Several processes can pass a limit by the traffic of one interval. That is
  accepted, and it is the one limit that is not exact.

## Consequences

- An operator can bound the transfer bill of published pages.
- An integration test proves that the reader path closes past the limit of an
  account and past the cap, with two server instances that share one total.
