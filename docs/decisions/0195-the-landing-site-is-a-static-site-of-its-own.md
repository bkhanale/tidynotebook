# 0195. The landing site is a static site of its own

- Status: Accepted
- Date: 2026-10-04

## Context

The application shell is no place for marketing pages, and the guide serves
both editions from `docs/guide/` (record 0152). Paddle approves a seller by a
site that shows the product, the prices, the terms, the privacy notice and a
refund policy. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- `apps/site` is a new package in the shape of `apps/docs`: pure modules that
  answer HTML, one build module that writes files, the one stylesheet of
  `apps/web`, the recipes of `packages/ui`, and the scan of
  `tools/check-design-rules.mjs`. It imports `@notesapp/core` for the catalog
  and `productName`.
- It serves `tidynotebook.com` with these pages: `/`, `/pricing`,
  `/self-hosted`, `/checkout`, `/terms`, `/privacy`, `/refunds`, and a page
  for an unknown address.
- `/pricing` shows both plans, both intervals, every limit and every feature,
  from the catalog. Its one primary button is the Standard plan.
- A plan button opens `/signup?plan=<plan>` of the application. The choice
  travels through the address check of the sign-up, and the subscribe screen
  preselects it.
- `/checkout` is the one page that loads a script of a third party, Paddle.js.
  The content policy of that page alone allows the Paddle origins. The client
  token and the environment of Paddle are settings of the build.
- The legal texts are Markdown files in `apps/site/content/`, rendered by
  `renderMarkdown`. The application names `/terms` and `/privacy` by address
  through the settings of record 0140.
- The site loads no analytics and sets no cookie.
- The build settings are `NOTESAPP_SITE_ORIGIN`, `NOTESAPP_SITE_APP_ORIGIN`,
  `NOTESAPP_SITE_DOCS_ORIGIN`, `NOTESAPP_SITE_PADDLE_ENVIRONMENT` and
  `NOTESAPP_SITE_PADDLE_CLIENT_TOKEN`.

## Consequences

- `tests/integration/site.test.ts` builds the site and proves each page, each
  link, each class in the stylesheet, and each price against the catalog.
- The image of the application holds no part of the site.
