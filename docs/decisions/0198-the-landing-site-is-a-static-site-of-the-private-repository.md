# 0198. The landing site is a static site of the private repository

- Status: Accepted
- Date: 2026-10-04

## Context

The application shell is no place for marketing pages, and the guide serves
both editions from `docs/guide/` (record 0152). Paddle approves a seller by a
site that shows the product, the prices, the terms, the privacy notice and a
refund policy. The prices live in the catalog of the billing service (record
0195). See [design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- The private repository holds the landing site. It builds static files, and
  Cloudflare serves them at `tidynotebook.com`.
- The pages: `/`, `/pricing`, `/self-hosted`, `/terms`, `/privacy`,
  `/refunds`, and a page for an unknown address.
- `/pricing` shows both plans, both intervals, every limit and every feature,
  from the catalog. Its one primary button is the Standard plan. A plan button
  opens the sign-up of the application.
- The page for a person on the cloud about plans and billing is a page of the
  site, not of the guide.
- The legal texts are Markdown files of the private repository. The core names
  `/terms` and `/privacy` of the site by address through the settings of
  record 0140.
- The site loads no analytics, sets no cookie, and loads no script of a third
  party.
- The guide is built by `apps/docs` and served by Cloudflare at
  `docs.tidynotebook.com`.

## Consequences

- A test of the site fails when a page states a number that the catalog does
  not hold.
- The image of the core holds no part of the site.
