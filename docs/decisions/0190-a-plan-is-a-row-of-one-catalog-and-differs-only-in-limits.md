# 0190. A plan is a row of one catalog and differs only in limits

- Status: Accepted
- Date: 2026-10-04

## Context

A plan that gates a feature needs a check in every screen and handler that
touches it, and it breaks the rule of record 0186. A limit already has one
row, `accounts`, and one check, `notesapp_add_usage` (record 0112). Text and
history live in PostgreSQL, where a byte costs more than in object storage.
Readers of a published page are strangers. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- `packages/core/src/billing/catalog.ts` is the one catalog. The server, the
  checkout, the site and `pnpm billing:check` read it. A GB is `1000000000`
  bytes.

| Plan     | Month, each user | Year, each user | Storage | Text and history | Published transfer, each month |
| -------- | ---------------- | --------------- | ------- | ---------------- | ------------------------------ |
| Standard | `$5`             | `$50`           | `10 GB` | `2 GB`           | `10 GB`                        |
| Pro      | `$10`            | `$100`          | `50 GB` | `2 GB`           | `50 GB`                        |

- Every feature is in both plans. No trial and no free plan.
- **Storage** is the account limit of record 0112.
- **Text and history** is a second limit inside storage. `workspace_usage`
  counts text bytes apart from attachment bytes, and `notesapp_add_usage`
  checks both sums of the owner account.
- **Published transfer** is the bytes that the reader path sends for the
  workspaces of an account in one calendar month in UTC (record 0198).
- With billing `off`, the text and transfer limits are absent, and the
  storage limit keeps `NOTESAPP_ACCOUNT_LIMIT_BYTES` and the setting of an
  administrator. With billing `paddle`, the plan sets all three, and an
  administrator change of the limit answers `billing_managed`.
- A complimentary account is a Paddle discount of the whole price. No second
  path grants coverage.

## Consequences

- A change of a price or a limit is one edit of the catalog, one change of the
  price in Paddle, and a deploy. `pnpm billing:check` catches a drift.
- A test of the site fails when a page states a number that the catalog does
  not hold.
- Integration tests prove each limit in the database with the use case
  bypassed, and the reserve of a deletion on a full account.
